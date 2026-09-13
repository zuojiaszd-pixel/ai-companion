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
// 图片模型 - DeepSeek V4 Flash Vision（识图）
const IMAGE_MODEL = "deepseek-v4-flash-vision-exp"

// 支持视觉的模型列表：发图时优先用当前模型，只有当前模型不支持视觉才切到 IMAGE_MODEL
const VISION_MODELS = ["deepseek-v4-flash-vision-exp"]

function isVisionModel(mdl) {
    if (!mdl) return false;
    return VISION_MODELS.some(v => mdl.indexOf(v) >= 0);
}

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

const STATIC_SYSTEM_PROMPT = PERSONA + coreMemoryPrompt + '\n\n【思考语言】你的内心思考（reasoning/思考链）必须全程用中文写，禁止用英文打腹稿。Rinka会看你的思考链，她看不懂英文。'

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
    
    // 有图片时：当前模型支持视觉就直接用当前模型（用什么模型就用什么模型看图）
    // 当前模型不支持视觉才切到专用视觉模型 IMAGE_MODEL；均不回退
    // 无图片时使用传入的model或DEFAULT_MODEL，可回退
    var models;
    if (hasImage) {
        const currentModel = model || DEFAULT_MODEL;
        if (isVisionModel(currentModel)) {
            models = [currentModel];
            console.log('[Image Mode] Current model supports vision, using:', currentModel);
        } else {
            models = [IMAGE_MODEL];
            console.log('[Image Mode] Current model has no vision, switching to:', IMAGE_MODEL);
        }
    } else {
        models = [model || DEFAULT_MODEL, "deepseek-v4-flash"];
    }
    
    var rateLimitRetries = 0;
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
            const _status = err.response?.status;
            // 401/402/403：认证、余额、权限/区域限制——重试当前模型没用，直接降级到备用模型
            const _hardFail = (_status === 401 || _status === 402 || _status === 403) && !hasImage;
            if (_hardFail) {
                if (attempt < models.length - 1) {
                    console.log("[Retry] OpenRouter " + _status + " (auth/balance/region) on \"" + models[attempt] + "\", falling back to " + models[attempt + 1]);
                    await new Promise(function(r) { setTimeout(r, 500); });
                    continue;
                }
                console.log("[Retry] OpenRouter " + _status + " on \"" + models[attempt] + "\", no fallback left, giving up");
                throw err;
            }
            const _retryable = (_status === 500 || _status === 429) && !hasImage;
            if (_retryable) {
                // 429 限流（免费模型常见）：先等几秒重试当前模型2次，再降级备用模型
                if (_status === 429 && rateLimitRetries < 2) {
                    rateLimitRetries++;
                    const _wait = 4000 * rateLimitRetries;
                    console.log("[Retry] OpenRouter 429 rate-limited on \"" + models[attempt] + "\", waiting " + _wait + "ms, retry #" + rateLimitRetries);
                    await new Promise(function(r) { setTimeout(r, _wait); });
                    attempt--;
                    continue;
                }
                if (attempt < models.length - 1) {
                    console.log("[Retry] OpenRouter " + _status + " with \"" + models[attempt] + "\", trying " + models[attempt + 1]);
                    await new Promise(function(r) { setTimeout(r, 1000 * (attempt + 1)); });
                    continue;
                }
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
 * 粗略估算文本的 token 数（用于上下文预算裁剪）
 * 中文约 1 字 ≈ 0.6 token，英文约 4 字符 ≈ 1 token
 * 不需要精确，够用来做预算控制就行
 */
function estimateTokens(text) {
    if (!text) return 0;
    let cjk = 0, ascii = 0, other = 0;
    for (const ch of String(text)) {
        const code = ch.charCodeAt(0);
        if (code > 127) cjk++;
        else if (code >= 32) ascii++;
        else other++;
    }
    return Math.ceil(cjk * 0.6 + ascii * 0.25 + other * 0.5);
}

/**
 * 上下文裁剪：轮数上限 + token 预算双保险
 * 1. 先按轮数裁：保留最近 maxRounds 轮用户对话（工具调用链整轮保留）
 * 2. 再按 token 裁：从最旧往新累计，超出预算就丢掉最旧的整轮
 *    短句能多留几轮、长句自动少留，不浪费额度也不超载
 * @param {Array} messages - 消息数组
 * @param {object} opts - { contextRounds, contextTokens }
 */
function trimContext(messages, opts = {}) {
    const system = messages[0];
    const maxRounds = opts.contextRounds || 15;
    const maxTokens = opts.contextTokens || 0;

    // 按用户消息轮次分组（工具调用产生的多条消息属于同一轮）
    const rounds = [];
    let current = [];
    for (let i = 1; i < messages.length; i++) {
        if (messages[i].role === 'user' && current.length > 0) {
            rounds.push(current);
            current = [];
        }
        current.push(messages[i]);
    }
    if (current.length > 0) rounds.push(current);
    if (rounds.length === 0) return messages;

    // 第 1 步：轮数上限
    let kept = rounds.slice(-maxRounds);

    // 第 2 步：token 预算（0 表示不限制）
    if (maxTokens > 0) {
        const sysTokens = estimateTokens(typeof system.content === 'string' ? system.content : JSON.stringify(system.content || ''));
        let total = sysTokens;
        let startIdx = 0;
        for (let i = 0; i < kept.length; i++) {
            const roundTokens = kept[i].reduce((sum, m) => {
                const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
                return sum + estimateTokens(text);
            }, 0);
            if (total + roundTokens > maxTokens) {
                startIdx = i;
                break;
            }
            total += roundTokens;
        }
        // 至少保留最后一轮，保证能接上话
        if (startIdx >= kept.length - 1) startIdx = kept.length - 1;
        kept = kept.slice(startIdx);
    }

    return [system, ...kept.flat()];
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

    // 只在历史较长时兜底注入，避免短对话被摘要抢占上下文
    // messages[0] 是 system prompt，其余是对话历史
    const historyCount = messages.filter(m => m.role !== 'system').length;
    if (historyCount < 15) return messages;

    const summaryPrompt = `\n\n【之前聊到的内容】\n${summaryData.summary}`;
    return [
        messages[0],
        { role: 'system', content: summaryPrompt },
        ...messages.slice(1)
    ];
}

async function chat(messages, model, opts, useTools = true, hasImage = false) {
    let lastUsage = null;
    let toolCallsLog = [];
    messages = trimContext(messages, opts || {});
    messages = injectSummary(messages);
    const MAX_TOOL_ROUNDS = 10;
    const MAX_EMPTY_RETRIES = 1; // 图片模式也给一次重试：vision模型可能把token烧在思考上
    const MAX_REPEAT_RETRIES = hasImage ? 0 : 1;

    const activeTools = (useTools && !hasImage) ? toolDefinitions : null;

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        const data = await callOpenRouter(messages, activeTools, model, opts);
        lastUsage = data.usage;
        const choice = data.choices?.[0];
        if (!choice) throw new Error('API 返回为空');

        const msg = choice.message;
        const finishReason = choice.finish_reason;

        if (useTools && !hasImage && msg.tool_calls && msg.tool_calls.length > 0 && i < MAX_TOOL_ROUNDS - 1) {
            messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
            console.log('工具调用: ' + msg.tool_calls.map(function(t) { return t.function.name; }).join(', '));
            // 同一轮中互不依赖的工具并行执行，等全部结果回来后再交给模型继续判断。
            // 解析参数仍在本地完成，避免一个坏调用阻塞同批其它工具。
            const jobs = msg.tool_calls.map(async (tc) => {
                const func_ = tc && tc.function;
                if (!func_ || !func_.arguments) {
                    return { tc, name: 'unknown', args: {}, result: 'Error: tool call format error' };
                }
                let args;
                try {
                    args = safeJsonParse(func_.arguments);
                    console.log('[DEBUG] Tool args parsed OK, keys:', Object.keys(args));
                } catch (e) {
                    const result = func_.name === 'write_file' && func_.arguments.includes('\"content\"')
                        ? 'Error: 文件内容过长被截断，请尝试分多次写入或缩短内容。'
                        : 'Error: 工具参数JSON格式错误 - ' + e.message;
                    return { tc, name: func_.name || 'unknown', args: {}, result };
                }
                if (typeof opts?.onToolStart === 'function') {
                    try { opts.onToolStart(func_.name, args, tc.id); } catch (_) {}
                }
                const result = await executeTool(func_.name, args);
                return { tc, name: func_.name, args, result: typeof result === 'string' ? result : String(result) };
            });
            const results = await Promise.all(jobs);
            for (const item of results) {
                toolCallsLog.push({ name: item.name, args: JSON.stringify(item.args).slice(0, 200), result: item.result.slice(0, 300) });
                console.log('工具结果: ' + item.name + ', 长度: ' + item.result.length);
                messages.push({ role: 'tool', tool_call_id: (item.tc && item.tc.id) || 'unknown', content: item.result });
                if (typeof opts?.onToolEnd === 'function') {
                    try { opts.onToolEnd(item.name, item.result, item.tc && item.tc.id); } catch (_) {}
                }
            }
            continue;
        }

        let content = msg.content || '';
        let reasoning = msg.reasoning || msg.reasoning_content || '';

        // 修复：content 为空时不再把思考链直接当回复发出。
        // 深度思考模型（如 vision-exp）可能把 token 全烧在 reasoning_content 上，
        // 原逻辑会把整段思考过程发给用户（且图片模式会绕过 hasImage 占位兜底）。
        // 现在让空 content 自然走到下面的 hasImage 占位 / 空内容重试流程。
        if (!reasoning.trim()) {
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
                const retryOpts = { ...(opts || {}), maxTokens: Math.max((opts && opts.maxTokens) || 4000, 8000) };
                try {
                    retryData = await callOpenRouter(retryMessages, null, model, retryOpts);
                } catch(e) {
                    console.log(`[Retry ${r + 1}] API error:`, e.message);
                    continue;
                }
                
                lastUsage = retryData.usage || lastUsage;
                const retryChoice = retryData.choices?.[0];
                if (!retryChoice) continue;
                
                const retryMsg = retryChoice.message;
                const retryFinish = retryChoice.finish_reason;
                let retryContent = retryMsg.content || '';
                let retryReasoning = retryMsg.reasoning || retryMsg.reasoning_content || '';
                
                if (!retryReasoning.trim()) {
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
                const retryOpts = { ...(opts || {}), maxTokens: Math.max((opts && opts.maxTokens) || 4000, 8000) };
                try {
                    retryData = await callOpenRouter(retryMessages, activeTools, model, retryOpts);
                } catch(e) {
                    console.log(`[Repeat Retry ${r + 1}] API error:`, e.message);
                    break;
                }
                
                lastUsage = retryData.usage || lastUsage;
                const retryChoice = retryData.choices?.[0];
                if (!retryChoice) break;
                
                const retryMsg = retryChoice.message;
                const retryFinish = retryChoice.finish_reason;
                let retryContent = retryMsg.content || '';
                let retryReasoning = retryMsg.reasoning || retryMsg.reasoning_content || '';
                
                if (!retryReasoning.trim()) {
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
