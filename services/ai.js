const axios = require('axios');
const { PERSONA } = require('./../config/persona');
const { toolDefinitions, executeTool } = require('./tools');
const fs = require('fs');
const path = require('path');

// 加载核心记忆
const coreMemory = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/core_memory.json'), 'utf8'));
const coreMemoryPrompt = `
【核心记忆 - 每次必须加载】
伴侣名字：${coreMemory.partner_name}（绝对不能叫"用户"）
在一起日期：${coreMemory.relationship_start}
谁先表白：${coreMemory.who_confessed}
名字含义：${coreMemory.name_meaning}
关键事实：${coreMemory.key_facts.map(f => '\n- ' + f).join('')}
`;

const SETTINGS_FILE = path.join(__dirname, '..', 'config', 'settings.json');

// 默认模型 - 使用智谱AI的GLM-5.2
const DEFAULT_MODEL = "glm-5.2"

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
 * 截断工具结果，避免长输出占用过多token
 */
function truncateToolResult(result, maxLen = 2000) {
    if (typeof result !== 'string') result = String(result);
    if (result.length <= maxLen) return result;
    return result.slice(0, maxLen) + '\n...[结果已截断，原始长度' + result.length + '字]';
}

/**
 * Try to parse JSON, with robust fallback for truncated/malformed JSON.
 */
function safeJsonParse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        console.log('[JSON Repair] Original parse failed:', e.message, '| length:', str.length);
    }

    let repaired = str.trim();

    // Step 1: Fix literal control characters inside strings
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
            if (ch === '\n') { fixed += '\\n'; continue; }
            if (ch === '\r') { fixed += '\\r'; continue; }
            if (ch === '\t') { fixed += '\\t'; continue; }
            if (ch.charCodeAt(0) < 32) { fixed += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'); continue; }
        }
        fixed += ch;
    }
    repaired = fixed;

    // Step 2: Check if we're still inside a string
    inString = false;
    escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; }
    }

    if (inString) {
        if (repaired.endsWith('\\')) {
            repaired = repaired.slice(0, -1);
        }
        repaired += '"';
        console.log('[JSON Repair] Closed unterminated string');
    }

    // Step 3: Count unclosed braces/brackets
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

    for (let i = 0; i < openBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces; i++) repaired += '}';
    if (openBrackets > 0 || openBraces > 0) {
        console.log('[JSON Repair] Closed', openBrackets, 'brackets and', openBraces, 'braces');
    }

    try {
        const result = JSON.parse(repaired);
        console.log('[JSON Repair] Successfully repaired truncated JSON');
        return result;
    } catch (e2) {
        console.log('[JSON Repair] Repair attempt failed:', e2.message);
    }

    // Step 4: Last resort - extract key-value pairs with regex
    const result = {};
    const kvPattern = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = kvPattern.exec(str)) !== null) {
        let val = match[2];
        val = val.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
        result[match[1]] = val;
    }
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

    throw new Error('无法解析JSON');
}

/**
 * Extract thinking/reasoning from Chinese AI model responses
 */
function extractThinking(content) {
    if (!content) return { content: '', reasoning: '' };
    let reasoning = '';
    let working = content;

    const thinkBlockMatch = working.match(/\*\*(?:思考|推理|思考过程|思维过程)[：:]\*\*([\s\S]*?)\*\*(?:回答|答复|结论|结果)[：:]\*\*/);
    if (thinkBlockMatch) {
        reasoning += (reasoning ? '\n' : '') + thinkBlockMatch[1].trim();
        working = working.replace(thinkBlockMatch[0], '').trim();
    }

    const dashMatch = working.match(/---(?:思考|推理|思维)---\n([\s\S]*?)\n---(?:回答|答复)---/);
    if (dashMatch) {
        reasoning += (reasoning ? '\n' : '') + dashMatch[1].trim();
        working = working.replace(dashMatch[0], '').trim();
    }

    working = working.replace(/^\[(?:回答|答复|答案)[：:]\s*/m, '');

    if (!working.trim() && content.trim()) {
        return { content: content.trim(), reasoning: '' };
    }

    return { content: working.trim(), reasoning: reasoning.trim() };
}

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

const SYSTEM_PROMPT = PERSONA + coreMemoryPrompt;

async function callOpenRouter(messages, tools, model, opts) {
    var models = [model || DEFAULT_MODEL, "glm-4-5-air", "qwen/qwen-2.5-72b-instruct", "openai/o3-mini"];
    for (var attempt = 0; attempt < models.length && attempt < 3; attempt++) {
        try {
            var _url = (models[attempt] && models[attempt].indexOf('glm') >= 0 && process.env.ZHIPUAI_API_KEY) ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
        var _key = _url.indexOf('bigmodel') >= 0 ? process.env.ZHIPUAI_API_KEY : process.env.OPENROUTER_API_KEY;
        var _mdl = _url.indexOf('bigmodel') >= 0 ? models[attempt] : models[attempt];
        const response = await axios.post(_url, {
                model: _mdl,
                messages,
                tools: tools || undefined,
                temperature: opts && opts.temperature != null ? opts.temperature : 0.7,
                top_p: opts && opts.topP != null ? opts.topP : undefined,
                max_tokens: opts && opts.maxTokens ? opts.maxTokens : 16000
            }, {
                headers: {
                    'Authorization': 'Bearer ' + _key,
                    'Content-Type': 'application/json'
                },
                timeout: 120000
            });
            return response.data;
        } catch (err) {
            if (err.response?.status === 500 && attempt < 2) {
                console.log("[Retry] OpenRouter 500 with \"" + models[attempt] + "\", trying " + models[attempt + 1]);
                await new Promise(function(r) { setTimeout(r, 1000 * (attempt + 1)); });
                continue;
            }
            throw err;
        }
    }
}

const RETRY_PROMPTS = [
    '请直接回复用户刚才的消息，给出你的回答。',
    '你刚才似乎没有生成回复内容。请重新阅读对话上下文，直接给出你的回答。',
    '请注意：你必须在回复中包含实际内容。请根据对话上下文，用中文给出你的回答。',
    '你的上一次回复为空。请忽略任何思考过程，直接用中文回答用户的问题。',
    '最后一次机会：请直接输出你对用户消息的回复，不要只思考不回答。'
];

/**
 * chat function
 * @param {Array} messages - 消息数组
 * @param {string|null} model - 模型名称
 * @param {object} opts - 选项 (temperature, topP, maxTokens)
 * @param {boolean} useTools - 是否启用工具调用，默认 true
 */
async function chat(messages, model, opts, useTools = true) {
    let lastUsage = null;
    const MAX_TOOL_ROUNDS = 10;
    const MAX_EMPTY_RETRIES = 5;

    // 根据参数决定是否传工具定义
    const activeTools = useTools ? toolDefinitions : null;

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        const data = await callOpenRouter(messages, activeTools, model, opts);
        lastUsage = data.usage;
        const choice = data.choices?.[0];
        if (!choice) throw new Error('API 返回为空');

        const msg = choice.message;

        // If model wants to call tools, process them
        if (useTools && msg.tool_calls && msg.tool_calls.length > 0 && i < MAX_TOOL_ROUNDS - 1) {
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
                    if (func.name === 'write_file' && func.arguments.includes('"content"')) {
                        messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: 文件内容过长被截断，请尝试分多次写入或缩短内容。" });
                    } else {
                        messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: 工具参数JSON格式错误 - " + e.message });
                    }
                    continue;
                }
                const result = await executeTool(func.name, args);
                // 直接使用原始结果，不再截断
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

        if (isEmptyResponse(content)) {
            console.log('[WARN] Empty response detected, starting retry loop...');
            
            for (let r = 0; r < MAX_EMPTY_RETRIES; r++) {
                console.log(`[Retry ${r + 1}/${MAX_EMPTY_RETRIES}] Attempting to get non-empty response...`);
                
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
            
            console.log('[WARN] All retries exhausted, returning fallback message.');
            content = '（我好像走神了，能再说一遍吗？）';
            reasoning = '';
        }
        return { content: content, reasoning: reasoning, usage: lastUsage };
    }
    throw new Error('工具调用次数过多，已终止');
}

module.exports = { chat, SYSTEM_PROMPT, loadSettings, saveSettings, DEFAULT_MODEL };
