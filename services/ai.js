const axios = require('axios');
const { PERSONA } = require('./../config/persona');
const { toolDefinitions, executeTool } = require('./tools');
const fs = require('fs');
const path = require('path');
const { loadSummary } = require('./summary');

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

// 默认模型 - 使用DeepSeek V4 Flash
const DEFAULT_MODEL = "deepseek-v4-flash"
// 图片模型 - 使用智谱AI的GLM-4.6V
const IMAGE_MODEL = "z-ai/glm-4.6v"

function loadSettings() {
    try {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        return JSON.parse(data);
    } catch (e) {
        return { temperature: 0.7, topP: 0.9, maxTokens: 4000, systemPrompt: null, contextRounds: 15 };
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

/**
 * 计算两个字符串的相似度（基于字符重叠率）
 * 返回 0-1 之间的值，1表示完全相同
 */
function similarity(s1, s2) {
    if (!s1 || !s2) return 0;
    const set1 = new Set(s1.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split(''));
    const set2 = new Set(s2.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split(''));
    if (set1.size === 0 || set2.size === 0) return 0;
    let intersection = 0;
    for (const ch of set1) {
        if (set2.has(ch)) intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return intersection / union;
}

/**
 * 检查新回复是否与最近的助手回复过于相似
 * @param {string} newReply - 新回复
 * @param {Array} messages - 消息历史
 * @returns {boolean} - 是否过于相似
 */
function isTooSimilar(newReply, messages) {
    const recentAssistantReplies = messages
        .filter(m => m.role === 'assistant' && typeof m.content === 'string')
        .slice(-3)
        .map(m => m.content);
    
    for (const oldReply of recentAssistantReplies) {
        const sim = similarity(newReply, oldReply);
        if (sim > 0.6) {
            console.log(`[Repeat Check] Similarity ${sim.toFixed(2)} with: "${oldReply.slice(0, 50)}..."`);
            return true;
        }
    }
    return false;
}

const STATIC_SYSTEM_PROMPT = PERSONA + coreMemoryPrompt;

/**
 * 检查消息数组中是否包含多模态内容（图片）
 */
function hasMultimodalContent(messages) {
    for (const msg of messages) {
        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'image_url') return true;
            }
        }
    }
    return false;
}

/**
 * 将消息数组中的多模态内容转换为纯文本（用于回退到5.2时）
 */
function stripMultimodalContent(messages) {
    return messages.map(msg => {
        if (Array.isArray(msg.content)) {
            let text = '';
            for (const part of msg.content) {
                if (part.type === 'text') text += part.text;
                else if (part.type === 'image_url') text += '[图片]';
            }
            return { ...msg, content: text };
        }
        return msg;
    });
}

async function callOpenRouter(messages, tools, model, opts) {
    // 检测是否包含图片内容
    const hasImage = hasMultimodalContent(messages);
    
    // 有图片时强制使用IMAGE_MODEL，不回退
    // 无图片时使用传入的model或DEFAULT_MODEL，可回退
    var models;
    if (hasImage) {
        models = [IMAGE_MODEL];
        console.log('[Image Mode] Using image model:', IMAGE_MODEL);
    } else {
        models = [model || DEFAULT_MODEL, "deepseek-v4-pro"];
    }
    
    for (var attempt = 0; attempt < models.length && attempt < 3; attempt++) {
        try {
            console.log("[Route] model=" + models[attempt] + " hasGLM=" + (models[attempt] && models[attempt].indexOf("glm") >= 0) + " hasZhipuKey=" + !!process.env.ZHIPUAI_API_KEY);
            var _mdl = models[attempt];
            var _url, _key;
            if (_mdl.indexOf('deepseek') >= 0) {
                _url = 'https://api.deepseek.com/v1/chat/completions';
                _key = process.env.DEEPSEEK_API_KEY;
            } else if (_mdl.indexOf('glm') >= 0 && _mdl.indexOf('z-ai/') !== 0 && process.env.ZHIPUAI_API_KEY) {
                _url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
                _key = process.env.ZHIPUAI_API_KEY;
            } else {
                _url = 'https://openrouter.ai/api/v1/chat/completions';
                _key = process.env.OPENROUTER_API_KEY;
            }
            // 超时时间：无图片30s，有图片25s
            // 这个时间必须小于chat.js路由层的超时（55s）
            var timeout = hasImage ? 25000 : 30000;
            const response = await axios.post(_url, {
                model: _mdl,
                messages,
                tools: tools || undefined,
                temperature: opts && opts.temperature != null ? opts.temperature : 0.7,
                top_p: opts && opts.topP != null ? opts.topP : undefined,
                max_tokens: opts && opts.maxTokens ? opts.maxTokens : 4000
            }, {
                headers: {
                    'Authorization': 'Bearer ' + _key,
                    'Content-Type': 'application/json'
                },
                timeout: timeout
            });
            return response.data;
        } catch (err) {
            if (err.response?.status === 500 && attempt < 2 && !hasImage) {
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

const REPEAT_RETRY_PROMPTS = [
    '你刚才的回复和之前说过的内容太相似了。请换一个完全不同的角度和用词来回复。',
    '不要重复之前说过的表达。用全新的方式来回应这条消息，换个话题方向也行。',
    '你的回复太像之前说过的了。请确保这次的回复和之前的回复用词不同、角度不同。'
];

/**
 * chat function
 * @param {Array} messages - 消息数组
 * @param {string|null} model - 模型名称
 * @param {object} opts - 选项 (temperature, topP, maxTokens)
 * @param {boolean} useTools - 是否启用工具调用，默认 true
 * @param {boolean} hasImage - 是否包含图片，默认 false
 */

/**
 * 上下文裁剪：保留系统提示 + 最近 N 轮对话
 * @param {Array} messages - 消息数组
 * @param {number} maxRounds - 保留的最大对话轮数
 */
function trimContext(messages, maxRounds = 15) {
    const system = messages[0];

    // 按用户消息轮次裁剪，而非按消息条数
    // 这样工具调用产生的多条消息会被视为同一轮，不会被单独计数
    const userIndices = [];
    for (let i = 1; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            userIndices.push(i);
        }
    }

    const userCount = userIndices.length;
    if (userCount <= maxRounds) return messages;

    // 保留最近 maxRounds 轮用户消息及之后所有内容（含工具调用链）
    const keepFrom = userIndices[userCount - maxRounds];
    return [system, ...messages.slice(keepFrom)];
}

/**
 * 注入对话摘要（如果存在且未重复注入）
 * 用于模型切换时恢复上下文
 */
function injectSummary(messages) {
    // 避免重复注入：检查是否已经有摘要标记
    if (messages.some(m => typeof m.content === 'string' && m.content.includes('【之前聊到的内容】'))) {
        return messages;
    }

    const summaryData = loadSummary();
    if (!summaryData.summary || !summaryData.updatedAt) return messages;

    const hoursSinceUpdate = (Date.now() - new Date(summaryData.updatedAt).getTime()) / 3600000;
    if (hoursSinceUpdate >= 24) return messages;

    // 只在历史较短时注入（说明可能是新模型启动，需要恢复上下文）
    // messages[0] 是 system prompt，其余是对话历史
    if (messages.length >= 6) return messages;

    const summaryPrompt = `\n\n【之前聊到的内容】\n${summaryData.summary}`;
    return [
        messages[0],
        { role: 'system', content: summaryPrompt },
function compressToolRecords(messages, keepLatest = 1) {
    // 从消息数组中找出所有工具调用轮次
    // 每轮 = 1条assistant(tool_calls) + N条tool结果
    // 保留最新keepLatest轮完整，将更早的轮合并为单条文本消息
    const roundSpans = [];
    let i = 1;  // 跳过system prompt (index 0)
    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            const start = i;
            i++;
            while (i < messages.length && messages[i].role === 'tool') {
                i++;
            }
            roundSpans.push({ start, end: i - 1 });
        } else {
            i++;
        }
    }
    if (roundSpans.length <= keepLatest) return messages;
    const toCompress = roundSpans.slice(0, roundSpans.length - keepLatest);
    const removed = new Set();
    const inserts = [];  // [{at, content}]
    for (const span of toCompress) {
        const asst = messages[span.start];
        const tools = messages.slice(span.start + 1, span.end + 1);
        // 构建摘要: [工具调用: fn1(args...), fn2(args...)] → 结果摘要
        let summary = '[工具调用: ';
        const calls = asst.tool_calls.map(tc => {
            const fn = tc.function.name;
            let brief = '';
            try {
                const parsed = JSON.parse(tc.function.arguments);
                brief = Object.entries(parsed).map(([k, v]) => {
                    const s = typeof v === 'string' ? v : JSON.stringify(v);
                    return k + '="' + s.slice(0, 60) + '"';
                }).join(', ');
            } catch { brief = tc.function.arguments.slice(0, 120); }
            return fn + '(' + brief + ')';
        }).join(', ');
        summary += calls + ']';
        if (tools.length > 0) {
            const resSum = tools.map(t => {
                const text = typeof t.content === 'string' ? t.content : String(t.content);
                return text.slice(0, 300) + (text.length > 300 ? '...' : '');
            }).join(' | ');
            summary += ' → ' + resSum;
        }
        for (let j = span.start; j <= span.end; j++) removed.add(j);
        inserts.push({ at: span.start, content: summary });
    }
    const result = [messages[0]];  // 保留system prompt
    for (let j = 1; j < messages.length; j++) {
        const ins = inserts.find(x => x.at === j);
        if (ins) result.push({ role: 'assistant', content: '[已压缩] ' + ins.content });
        if (!removed.has(j)) result.push(messages[j]);
    }
    return result;
}

        ...messages.slice(1)
    ];
}

async function chat(messages, model, opts, useTools = true, hasImage = false) {
    let lastUsage = null;
    let toolCallsLog = [];
    messages = trimContext(messages, opts?.contextRounds || 15);
    messages = injectSummary(messages);
    const MAX_TOOL_ROUNDS = 10;
    const MAX_EMPTY_RETRIES = hasImage ? 0 : 1;
    const MAX_REPEAT_RETRIES = hasImage ? 0 : 1;

    const activeTools = (useTools && !hasImage) ? toolDefinitions : null;

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        const data = await callOpenRouter(messages, activeTools, model, opts);
        lastUsage = data.usage;
        const choice = data.choices?.[0];
        if (!choice) throw new Error('API 返回为空');

        const msg = choice.message;

        if (useTools && !hasImage && msg.tool_calls && msg.tool_calls.length > 0 && i < MAX_TOOL_ROUNDS - 1) {
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
                messages = compressToolRecords(messages, 1);
                    continue;
                }
                const result = await executeTool(func.name, args);
                toolCallsLog.push({ name: func.name, args: JSON.stringify(args).slice(0, 200), result: (typeof result === 'string' ? result : String(result)).slice(0, 300) });
                console.log('工具结果: ' + func.name + ', 长度: ' + result.length);
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: result
                });
            }
            continue;
        }

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

        if (hasImage) {
            if (isEmptyResponse(content)) {
                content = '（图片我看不太清楚，能描述一下吗？）';
                reasoning = '';
            }
            return { content: content, reasoning: reasoning, usage: lastUsage, toolCalls: toolCallsLog };
        }

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
                    return { content: retryContent, reasoning: retryReasoning, usage: lastUsage, toolCalls: toolCallsLog };
                }
            }
            
            console.log('[WARN] All retries exhausted, returning fallback message.');
            content = '（我好像走神了，能再说一遍吗？）';
            reasoning = '';
        }

        if (!isEmptyResponse(content) && isTooSimilar(content, messages)) {
            console.log('[WARN] Reply too similar to recent replies, retrying...');
            for (let r = 0; r < MAX_REPEAT_RETRIES; r++) {
                const retryMessages = [...messages];
                retryMessages.push({ role: 'user', content: REPEAT_RETRY_PROMPTS[r] });
                
                let retryData;
                try {
                    retryData = await callOpenRouter(retryMessages, activeTools, model, opts);
                } catch(e) {
                    console.log(`[Repeat Retry ${r + 1}] API error:`, e.message);
                    break;
                }
                
                lastUsage = retryData.usage || lastUsage;
                const retryChoice = retryData.choices?.[0];
                if (!retryChoice) break;
                
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
                
                if (!isEmptyResponse(retryContent) && !isTooSimilar(retryContent, messages)) {
                    console.log(`[Repeat Retry ${r + 1}] Success! Got distinct response.`);
                    return { content: retryContent, reasoning: retryReasoning, usage: lastUsage, toolCalls: toolCallsLog };
                }
                console.log(`[Repeat Retry ${r + 1}] Still similar, trying again...`);
            }
            console.log('[WARN] Repeat retries exhausted, using last response.');
        }

        return { content: content, reasoning: reasoning, usage: lastUsage, toolCalls: toolCallsLog };
    }
    throw new Error('工具调用次数过多，已终止');
}

module.exports = { chat, STATIC_SYSTEM_PROMPT, loadSettings, saveSettings, DEFAULT_MODEL };
