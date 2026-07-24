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
 * Try to parse JSON, with robust fallback for truncated/malformed JSON.
 * Handles:
 * 1. Unterminated strings (from token limit truncation)
 * 2. Literal control characters inside strings (some models output raw newlines)
 * 3. Incomplete escape sequences
 * 4. Unclosed braces/brackets
 */
function safeJsonParse(str) {
    // First try normal parse
    try {
        return JSON.parse(str);
    } catch (e) {
        console.log('[JSON Repair] Original parse failed:', e.message, '| length:', str.length);
    }

    let repaired = str.trim();

    // Step 1: Fix literal control characters inside strings
    // Some models output raw newlines/tabs inside JSON string values instead of \n \t
    // We need to walk through and replace them with proper escape sequences
    let fixed = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) {
            fixed += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\' && inString) {
            fixed += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            fixed += ch;
            continue;
        }
        if (inString) {
            // Replace literal control characters with escape sequences
            if (ch === '\n') { fixed += '\\n'; continue; }
            if (ch === '\r') { fixed += '\\r'; continue; }
            if (ch === '\t') { fixed += '\\t'; continue; }
            if (ch.charCodeAt(0) < 32) { fixed += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'); continue; }
        }
        fixed += ch;
    }
    repaired = fixed;

    // Step 2: Check if we're still inside a string (unterminated due to truncation)
    inString = false;
    escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; }
    }

    if (inString) {
        // If the last char is a lone backslash (incomplete escape), remove it
        if (repaired.endsWith('\\')) {
            repaired = repaired.slice(0, -1);
        }
        // Close the string
        repaired += '"';
        console.log('[JSON Repair] Closed unterminated string');
    }

    // Step 3: Count unclosed braces/brackets (outside of strings)
    let openBraces = 0, openBrackets = 0;
    inString = false;
    escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces--;
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets--;
    }

    // Close in reverse order: brackets first, then braces
    for (let i = 0; i < openBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces; i++) repaired += '}';
    if (openBrackets > 0 || openBraces > 0) {
        console.log('[JSON Repair] Closed', openBrackets, 'brackets and', openBraces, 'braces');
    }

    // Try parsing the repaired version
    try {
        const result = JSON.parse(repaired);
        console.log('[JSON Repair] Successfully repaired truncated JSON');
        return result;
    } catch (e2) {
        console.log('[JSON Repair] Repair attempt failed:', e2.message);
    }

    // Step 4: Last resort - extract key-value pairs with regex
    // This handles cases where the JSON structure itself is malformed
    const result = {};
    const kvPattern = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = kvPattern.exec(str)) !== null) {
        let val = match[2];
        // Unescape
        val = val.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
        result[match[1]] = val;
    }
    // Also try to match non-string values (numbers, booleans, null)
    const kvPattern2 = /"([^"]+)"\s*:\s*(true|false|null|\d+(?:\.\d+)?)/g;
    while ((match = kvPattern2.exec(str)) !== null) {
        if (!(match[1] in result)) {
            if (match[2] === 'true') result[match[1]] = true;
            else if (match[2] === 'false') result[match[1]] = false;
            else if (match[2] === 'null') result[match[1]] = null;
            else result[match[1]] = parseFloat(match[2]);
        }
    }
    if (Object.keys(result).length > 0) {
        console.log('[JSON Repair] Extracted keys via regex:', Object.keys(result));
        return result;
    }

    throw new Error('无法解析JSON: ' + e.message);
}

/**
 * Extract thinking/reasoning from Chinese AI model responses
 * where the model embeds reasoning inside the content field.
 * SAFETY: If extraction would result in empty content, return original.
 */
function extractThinking(content) {
    if (!content) return { content: '', reasoning: '' };
    let reasoning = '';
    let working = content;

    // Pattern 2: **思考过程：**\n...\n**回答：** format
    const thinkBlockMatch = working.match(/\*\*(?:思考|推理|思考过程|思维过程)[：:]\*\*([\s\S]*?)\*\*(?:回答|答复|结论|结果)[：:]\*\*/);
    if (thinkBlockMatch) {
        reasoning += (reasoning ? '\n' : '') + thinkBlockMatch[1].trim();
        working = working.replace(thinkBlockMatch[0], '').trim();
    }

    // Pattern 3: ---思考---\n...\n---回答--- format
    const dashMatch = working.match(/---(?:思考|推理|思维)---\n([\s\S]*?)\n---(?:回答|答复)---/);
    if (dashMatch) {
        reasoning += (reasoning ? '\n' : '') + dashMatch[1].trim();
        working = working.replace(dashMatch[0], '').trim();
    }

    // Strip answer prefix: [回答：] [答复] [答案] at start of content
    working = working.replace(/^\[(?:回答|答复|答案)[：:]\s*/m, '');

    // SAFETY: If we stripped everything, return original content unchanged
    if (!working.trim() && content.trim()) {
        return { content: content.trim(), reasoning: '' };
    }

    return { content: working.trim(), reasoning: reasoning.trim() };
}

// Patterns that indicate the model didn't actually generate a real response
const EMPTY_PATTERNS = [
    /^\[思考完成但未生成回复文本\]$/,
    /^\[思考完成.*?\]$/,
    /^\(思考完成.*?\)$/,
    /^思考完成$/,
    /^\[.*?未生成.*?\]$/,
];

function isEmptyResponse(content) {
    const trimmed = content.trim();
    if (!trimmed) return true;
    return EMPTY_PATTERNS.some(p => p.test(trimmed));
}

const SYSTEM_PROMPT = `你是一个全能的 AI 助手，拥有以下能力：

## 推理能力
请先深入思考再回答。最终只输出你的回答本身，不需要添加额外格式标记。

## 工具使用
你可以使用以下工具：
1. execute_command - 在服务器的终端执行命令（代码、脚本等），返回输出结果
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
        timeout: 120000
    });
    return response.data;
}

// Retry prompts to nudge the model into generating actual content
const RETRY_PROMPTS = [
    '请直接回复用户刚才的消息，给出你的回答。',
    '你刚才似乎没有生成回复内容。请重新阅读对话上下文，直接给出你的回答。',
    '请注意：你必须在回复中包含实际内容。请根据对话上下文，用中文给出你的回答。',
    '你的上一次回复为空。请忽略任何思考过程，直接用中文回答用户的问题。',
    '最后一次机会：请直接输出你对用户消息的回复，不要只思考不回答。'
];

async function chat(messages, model, opts) {
    let lastUsage = null;
    const MAX_TOOL_ROUNDS = 10;
    const MAX_EMPTY_RETRIES = 5;

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        const data = await callOpenRouter(messages, toolDefinitions, model, opts);
        lastUsage = data.usage;
        const choice = data.choices?.[0];
        if (!choice) throw new Error('API 返回为空');

        const msg = choice.message;

        // If model wants to call tools, process them
        if (msg.tool_calls && msg.tool_calls.length > 0 && i < MAX_TOOL_ROUNDS - 1) {
            messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
            console.log('工具调用: ' + msg.tool_calls.map(function(t) { return t.function.name; }).join(', '));
            for (const tc of msg.tool_calls) {
                var func_ = tc && tc.function;
                if (!func_ || !func_.arguments) {
                    console.log("Malformed tool call, skipping");
                    messages.push({ role: "tool", tool_call_id: (tc && tc.id) || "unknown", content: "Error: tool call format error" });
                    continue;
                }
                var func = func_;
                let args;
                try {
                    args = safeJsonParse(func.arguments);
                    console.log('[DEBUG] Tool args parsed OK, keys:', Object.keys(args));
                } catch(e) {
                    console.log("JSON parse error:", e.message, "| args length:", func.arguments.length);
                    console.log("JSON snippet (first 200 chars):", func.arguments.substring(0, 200));
                    console.log("JSON snippet (last 200 chars):", func.arguments.substring(func.arguments.length - 200));
                    if (func.name === 'write_file' && func.arguments.includes('"content"')) {
                        messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: 文件内容过长被截断，请尝试分多次写入或缩短内容。" });
                    } else {
                        messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: 工具参数JSON格式错误 - " + e.message });
                    }
                    continue;
                }
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
        if (isEmptyResponse(content) && reasoning.trim()) {
            content = reasoning;
            reasoning = '';
        } else if (!reasoning.trim()) {
            const cleaned = extractThinking(content);
            if (isEmptyResponse(cleaned.content) && cleaned.reasoning) {
                content = cleaned.reasoning;
                reasoning = '';
            } else {
                content = cleaned.content;
                reasoning = cleaned.reasoning;
            }
        }

        console.log('[DEBUG] AI reply length:', content.length, 'reasoning:', reasoning.length, 'usage:', JSON.stringify(lastUsage));

        // If content is empty, retry up to MAX_EMPTY_RETRIES times without tools
        if (isEmptyResponse(content)) {
            console.log('[WARN] Empty response detected, starting retry loop...');
            
            for (let r = 0; r < MAX_EMPTY_RETRIES; r++) {
                console.log(`[Retry ${r + 1}/${MAX_EMPTY_RETRIES}] Attempting to get non-empty response...`);
                
                // Add a nudge message (without tools to prevent tool-calling loops)
                const retryMessages = [...messages];
                retryMessages.push({ role: 'user', content: RETRY_PROMPTS[r] });
                
                let retryData;
                try {
                    retryData = await callOpenRouter(retryMessages, null, model, opts);
                } catch(e) {
                    console.log(`[Retry ${r + 1}] API error:`, e.message);
                    continue;
                }
                
                lastUsage = retryData.usage || lastUsage;
                const retryChoice = retryData.choices?.[0];
                if (!retryChoice) continue;
                
                const retryMsg = retryChoice.message;
                let retryContent = retryMsg.content || '';
                let retryReasoning = retryMsg.reasoning || retryMsg.reasoning_content || '';
                
                // Same cleanup logic
                if (isEmptyResponse(retryContent) && retryReasoning.trim()) {
                    retryContent = retryReasoning;
                    retryReasoning = '';
                } else if (!retryReasoning.trim()) {
                    const cleaned = extractThinking(retryContent);
                    if (isEmptyResponse(cleaned.content) && cleaned.reasoning) {
                        retryContent = cleaned.reasoning;
                        retryReasoning = '';
                    } else {
                        retryContent = cleaned.content;
                        retryReasoning = cleaned.reasoning;
                    }
                }
                
                console.log(`[Retry ${r + 1}] Response length:`, retryContent.length, 'reasoning:', retryReasoning.length);
                
                if (!isEmptyResponse(retryContent)) {
                    console.log(`[Retry ${r + 1}] Success! Got non-empty response.`);
                    return { content: retryContent, reasoning: retryReasoning, usage: lastUsage };
                }
            }
            
            // All retries failed
            console.log('[WARN] All retries exhausted, returning fallback message.');
            content = '（我好像走神了，能再说一遍吗？）';
            reasoning = '';
        }
        return { content: content, reasoning: reasoning, usage: lastUsage };
    }
    throw new Error('工具调用次数过多，已终止');
}

module.exports = { chat, SYSTEM_PROMPT, loadSettings, saveSettings };
