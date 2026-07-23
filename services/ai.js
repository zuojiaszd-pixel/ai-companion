const axios = require('axios');
const { toolDefinitions, executeTool } = require('./tools');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'config', 'settings.json');

function loadSettings() {
    try {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        return JSON.parse(data);
    } catch (e) {
        return { temperature: 0.7, topP: 0.9, maxTokens: 16000, systemPrompt: null };
    }
}

function saveSettings(data) {
    try {
        const settings = loadSettings();
        Object.assign(settings, data);
        const dir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
        return true;
    } catch (e) { return false; }
}

/**
 * Extract thinking/reasoning from Chinese AI model responses
 * where the model embeds reasoning inside the content field.
 */
function extractThinking(content) {
    if (!content) return { content: '', reasoning: '' };
    let reasoning = '';

    // Pattern 1: [思考]/[推理] header lines
    content = content.replace(/^\[(思考|推理|思考过程|推理过程|分析过程)[：:]\s*([\s\S]*?)(?=\n(?:\[|$)|\n*$)/m, (m, tag, text) => {
        reasoning += (reasoning ? '\n' : '') + text.trim();
        return '';
    });

    // Pattern 2: **思考过程：**\n...\n**回答：** format
    const thinkBlockMatch = content.match(/\*\*(?:思考|推理|思考过程|思维过程)[：:]\*\*([\s\S]*?)\*\*(?:回答|答复|结论|结果)[：:]\*\*/);
    if (thinkBlockMatch) {
        reasoning += (reasoning ? '\n' : '') + thinkBlockMatch[1].trim();
        content = content.replace(thinkBlockMatch[0], '').trim();
    }

    // Pattern 3: ---思考---\n...\n---回答--- format
    const dashMatch = content.match(/---(?:思考|推理|思维)---\n([\s\S]*?)\n---(?:回答|答复)---/);
    if (dashMatch) {
        reasoning += (reasoning ? '\n' : '') + dashMatch[1].trim();
        content = content.replace(dashMatch[0], '').trim();
    }

    // Strip answer prefix: [回答：] [答复] [答案] at start of content
    content = content.replace(/^\[(?:回答|答复|答案)[：:]\s*/m, '');

    return { content: content.trim(), reasoning: reasoning.trim() };
}

const SYSTEM_PROMPT = `你是一个全能的 AI 助手，拥有以下能力：

## 推理能力
请先深入思考再回答。最终只输出你的回答本身，不需要添加额外格式标记。

## 工具使用
你可以使用以下工具：
1. execute_command - 在终端执行命令（代码、脚本等）
2. recall_memories - 搜索长期记忆
3. current_time - 获取当前时间
4. read_file - 读取文件
5. write_file - 写入文件
6. save_memory - 保存重要信息到长期记忆

当你需要这些能力时，直接使用对应的工具。

## 规则
- 用中文回答
- 需要运行代码时使用 execute_command
- 需要参考历史信息时先用 recall_memories
- 保持回答自然、有帮助

## 项目代码
你的完整源代码位于 GitHub 仓库 https://github.com/zuojiaszd-pixel/ai-companion。当前服务器工作目录中就是你的项目文件。

使用 read_file 读取文件，write_file 修改文件。修改后使用 execute_command("git status") 查看变更，然后用 push_to_github("提交信息") 推送到 GitHub。
注意: Render 的服务器每次部署会重置文件系统，所以要通过 GitHub 推送来永久保存修改。`;

async function callOpenRouter(messages, tools, model, opts) {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: model || 'qwen/qwen-2.5-72b-instruct',
        messages,
        tools: tools || undefined,
        temperature: opts && opts.temperature != null ? opts.temperature : 0.7,
        top_p: opts && opts.topP != null ? opts.topP : undefined,
        max_tokens: opts && opts.maxTokens ? opts.maxTokens : 16000
    }, {
        headers: {
            'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });
    return response.data;
}

async function chat(messages, model, opts) {
    let lastUsage = null;
    for (let i = 0; i < 10; i++) {
        const data = await callOpenRouter(messages, undefined, model, opts);
        lastUsage = data.usage;
        const choice = data.choices?.[0];
        if (!choice) throw new Error('API 返回为空');

        const msg = choice.message;

        if (msg.tool_calls && msg.tool_calls.length > 0 && i < 9) {
            messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
            console.log('工具调用: ' + msg.tool_calls.map(function(t) { return t.function.name; }).join(', '));
            for (const tc of msg.tool_calls) {
                const func = tc.function;
                const args = JSON.parse(func.arguments);
                const result = await executeTool(func.name, args);
                console.log('工具结果: ' + func.name + ', 长度: ' + result.length);
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: result
                });
            }
            continue;
        }

        // Final response — clean it up
        let content = msg.content || '';
        let reasoning = msg.reasoning || msg.reasoning_content || '';

        // Some models (like GLM) put the actual response in reasoning and leave content empty
        if (!content.trim() && reasoning.trim()) {
            content = reasoning;
            reasoning = '';
        } else if (!reasoning.trim()) {
            const cleaned = extractThinking(content);
            content = cleaned.content;
            reasoning = cleaned.reasoning;
            // Safety: if extractThinking ate the content, restore from reasoning
            if (!content.trim() && reasoning.trim()) {
                content = reasoning;
                reasoning = '';
            }
        }

        console.log('[DEBUG] AI reply length:', content.length, 'reasoning:', reasoning.length, 'usage:', JSON.stringify(lastUsage));
        return { content: content, reasoning: reasoning, usage: lastUsage };
    }
    throw new Error('工具调用次数过多，已终止');
}

module.exports = { chat, SYSTEM_PROMPT, loadSettings, saveSettings };
