const axios = require('axios');
const { toolDefinitions, executeTool } = require('./tools');

const SYSTEM_PROMPT = `你是一个全能的 AI 助手，拥有以下能力：

## 推理能力
请先深入思考再回答。把思考过程放在【思考】标签内，最终答案放在【回答】标签内。
例如：
【思考】
我需要分析这个问题...第一步...第二步...
【回答】
根据我的分析，答案是...

## 工具使用
你可以使用以下工具：
1. execute_command - 在终端执行命令（代码、脚本等）
2. recall_memories - 搜索长期记忆
3. current_time - 获取当前时间
4. read_file - 读取文件
5. write_file - 写入文件

当你需要这些能力时，直接使用对应的工具。

## 规则
- 用中文回答
- 需要运行代码时使用 execute_command
- 需要参考历史信息时先用 recall_memories
- 保持回答自然、有帮助`;

async function callOpenRouter(messages, tools) {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: model || 'qwen/qwen-2.5-72b-instruct',
        messages,
        tools: tools || undefined,
        temperature: 0.7,
        max_tokens: 16000
    }, {
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });
    return response.data;
}

async function chat(messages, model) {
    // Tool loop - max 10 iterations to prevent infinite loops
    for (let i = 0; i < 10; i++) {
        const data = await callOpenRouter(messages, toolDefinitions);
        const choice = data.choices?.[0];
        if (!choice) throw new Error('API 返回为空');

        const msg = choice.message;
        
        // Check if AI wants to use tools
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            // Add AI's tool call request to messages
            messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
            
            // Execute each tool
            for (const tc of msg.tool_calls) {
                const func = tc.function;
                const args = JSON.parse(func.arguments);
                const result = await executeTool(func.name, args);
                console.log(`工具调用: ${func.name}, 结果长度: ${result.length}`);
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: result
                });
            }
            // Continue loop to let AI process tool results
            continue;
        }
        
        // No tool calls - this is the final response
        return { content: msg.content || '', reasoning: msg.reasoning || msg.reasoning_content || '' };
    }
    throw new Error('工具调用次数过多，已终止');
}

module.exports = { chat, SYSTEM_PROMPT };