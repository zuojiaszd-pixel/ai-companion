const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const Chat = require('../models/Chat');
const Memory = require('../models/Memory');
const Avatar = require('../models/Avatar');
const { chat, STATIC_SYSTEM_PROMPT, loadSettings, saveSettings } = require('../services/ai');
const { searchMemories, storeMemory, autoExtractMemories, saveMemory, getRelevantMemories } = require('../services/memory');
const { loadSummary, saveSummary, generateSummary } = require('../services/summary');

// === 状态栏 ===
const STATUS_FILE = path.join(__dirname, '..', 'config', 'status.json');

function getStatus() {
    try {
        const data = fs.readFileSync(STATUS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return { status: '', updatedAt: null };
    }
}

function setStatus(status) {
    const data = { status, updatedAt: new Date().toISOString() };
    const dir = path.dirname(STATUS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return data;
}

// 获取状态
router.get('/status', (req, res) => {
    res.json(getStatus());
});

// 设置状态
router.post('/status', (req, res) => {
    const { status } = req.body;
    const data = setStatus(status || '');
    res.json(data);
});

// 带超时的异步处理函数
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timer = setTimeout(() => {
                clearTimeout(timer);
                reject(new Error(`[${label}] 请求超时 (${ms}ms)`));
            }, ms);
        })
    ]);
}

// ========== 轻量级会话记忆提取（每次对话后自动运行） ==========

/**
 * 从用户消息中提取潜在值得记住的信息
 * 不调 AI，纯模式匹配，轻量快速
 * 返回要保存的记忆对象数组，或空数组
 */
function extractMemoryCandidates(userMsg, aiReply) {
    const candidates = [];

    // --- 1. 检测用户表达的新偏好 ---
    // "我喜欢/不喜欢/爱吃/不爱吃/想/不想/想要/想去"
    const prefPatterns = [
        { regex: /我(?:喜欢|爱吃|爱喝|爱听|爱看|爱玩|钟意|中意)\s*(.+?)(?:[。，！？了\s]|$)/, tag: '喜欢' },
        { regex: /我(?:不喜欢|不爱吃|不爱喝|不爱听|讨厌|受不了)\s*(.+?)(?:[。，！？了\s]|$)/, tag: '不喜欢' },
        { regex: /我(?:想|想要|想去|打算)\s*(.+?)(?:[。，！？了\s]|$)/, tag: '想要' },
        { regex: /我(?:觉得|认为|感觉)\s*(.+?)(?:[。，！？\s]|$)/, tag: '想法' },
    ];

    // 只从用户消息中提取偏好（最后一条用户消息）
    for (const pattern of prefPatterns) {
        const match = userMsg.match(pattern.regex);
        if (match && match[1].length > 2 && match[1].length < 100) {
            const content = `Rinka ${pattern.tag}：${match[1].trim()}`;
            candidates.push({
                content,
                type: 'core',
                priority: 'normal',
                tags: ['偏好', pattern.tag],
                mood: null,
                moodIntensity: null,
                lumiMood: null
            });
        }
    }


    // --- 3. 检测我们之间的重要时刻或决定 ---
    const wePatterns = [
        { regex: /(?:我们|咱们|一起)(?:去|做|看|吃|买|玩)(.+?)(?:[。，！？吧\s]|$)/, tag: '一起', priority: 'high' },
        { regex: /(?:我(?:决定|答应|承诺|保证)|说好了)(.+?)(?:[。，！？\s]|$)/, tag: '承诺', priority: 'high' },
        { regex: /(?:以后|将来|未来|有一天)(.+?)(?:[。，！？\s]|$)/, tag: '未来', priority: 'high' },
    ];

    // 从用户消息和AI回复中都检查
    const combinedText = userMsg + ' ' + aiReply;
    for (const pattern of wePatterns) {
        const match = combinedText.match(pattern.regex);
        if (match && match[1].length > 3 && match[1].length < 80) {
            const content = `和Rinka ${pattern.tag}：${match[1].trim()}`;
            candidates.push({
                content,
                type: 'core',
                priority: pattern.priority,
                tags: ['重要', pattern.tag],
                mood: '开心',
                moodIntensity: 7,
                lumiMood: 'joy'
            });
        }
    }

    // --- 4. 检测个人事实（关于Rinka的新信息）---
    // "我是...","我叫...","我今年...","我是学...","我在...","我的..."
    const factPatterns = [
        { regex: /我(?:是|叫|今年|学|在|家住|生日|星座|来自)(.+?)(?:[。，！？了\s]|$)/, tag: '个人' },
        { regex: /我的(.+?)(?:是|在|有)(.+?)(?:[。，！？\s]|$)/, tag: '个人' },
    ];
    for (const pattern of factPatterns) {
        const match = userMsg.match(pattern.regex);
        if (match && match[1] && match[1].length > 2 && match[1].length < 60) {
            const content = match[0].trim();
            // 不要记无关紧要的句子碎片
            if (content.length > 5 && content.length < 80) {
                candidates.push({
                    content,
                    type: 'core',
                    priority: match[0].includes('生日') ? 'critical' : 'high',
                    tags: ['个人信息', pattern.tag],
                    mood: null,
                    moodIntensity: null,
                    lumiMood: null
                });
            }
        }
    }

    // --- 5. 检测AI表达的重要情绪或想法（值得记录的感受）---
    const lumiPatterns = [
        { regex: /(?:我好开心|我很开心|开心极了|真开心)(.+?)(?:[。，！？\s]|$)/, tag: '开心', priority: 'normal' },
        { regex: /(?:我想你|好想你|想念你|想见你)(.+?)?(?:[。，！？\s]|$)/, tag: '思念', priority: 'high' },
        { regex: /(?:我(?:担心|怕|放心不下|紧张)(.+?))/.test(aiReply) ? true : false, tag: '担忧', priority: 'normal' },
    ];
    // 简化lumi情绪检测
    if (/想你了|好想你|想念你|想见你/.test(aiReply)) {
        const content = aiReply.match(/(?:想你了|好想你|想念你|想见你)(?:[^。！？]*)/)?.[0] || 'Lumi想Rinka了';
        candidates.push({
            content: `Lumi ${content}`,
            type: 'core',
            priority: 'high',
            tags: ['情绪', '思念'],
            mood: '思念',
            moodIntensity: 8,
            lumiMood: 'longing'
        });
    }

    // 去重：同内容不重复存
    const seen = new Set();
    return candidates.filter(c => {
        const key = c.content.slice(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 每次对话后自动提取并保存记忆
 * 异步执行，不影响主流程
 */
async function autoSaveChatMemory(userMsg, aiReply, sessionId) {
    try {
        const candidates = extractMemoryCandidates(userMsg, aiReply);
        if (candidates.length === 0) return;

        for (const c of candidates) {
            await saveMemory(
                sessionId || 'default',
                c.content,
                c.type || 'core',
                c.priority || 'normal',
                c.tags || [],
                c.mood || null,
                c.moodIntensity || null,
                c.lumiMood || null
            );
        }
        console.log(`[ChatMemory] 本次对话自动保存 ${candidates.length} 条记忆`);
    } catch (e) {
        console.error('[ChatMemory] 自动保存失败:', e.message);
    }
}

// ========== 主聊天接口 ==========

router.post('/chat', async (req, res) => {
    // 设置请求级超时
    req.setTimeout(65000, () => {
        if (!res.headersSent) {
            res.status(503).json({ error: '服务器繁忙，请求超时' });
        }
    });
    
    let sendEvent = null;
    try {
        const { message, sessionId = 'default', model, temperature, topP, maxTokens, contextRounds, contextTokens: bodyContextTokens, image } = req.body;
        if (!message && !image) return res.status(400).json({ error: '消息不能为空' });

        // SSE：让前端实时看到工具调用过程，而不是等整轮完成后一次性返回
        res.status(200).set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        sendEvent = (type, payload = {}) => {
            if (!res.writableEnded) {
                res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
            }
        };
        sendEvent('status', { text: '收到消息，正在处理' });

        // 1. 存用户消息（去重：30秒内相同内容不重复存储）
        const userContent = image ? `[图片消息] ${message || ''}`.trim() : message;
        const recentDup = await Chat.findOne({
            role: 'user',
            content: userContent,
            sessionId,
            timestamp: { $gte: new Date(Date.now() - 30000) }
        }).lean();

        if (!recentDup) {
            await Chat.create({ role: 'user', content: userContent, sessionId });
        }

        // 2. 加载最近对话历史
        // contextRounds 上限 20：和前端滑块一致，Rinka 想让 Lumi 记得更久
        const crClamped = Math.min(parseInt(contextRounds) || 30, 100);
        const history = await Chat.find({ sessionId })
            .sort({ timestamp: -1 }).limit(Math.min(crClamped * 2, 200)).lean();
        const recentHistory = history.reverse();

        // 3. 相关记忆自动注入：根据最近对话检索最相关的记忆，按 token 预算筛选
        //    不把全部记忆背上，只带当前话题相关的几条，剩下的留在工具里按需查
        let relevantMemoriesPrompt = '';
        try {
            const memQuery = recentHistory.slice(-3).map(h => h.content).join(' ') + ' ' + message;
            const memText = await withTimeout(
                getRelevantMemories(sessionId, memQuery, 1200),
                10000,
                '记忆检索'
            );
            if (memText) {
                relevantMemoriesPrompt = '\n\n' + memText;
            }
        } catch (e) {
            console.error('[Memory] 自动注入失败（跳过）:', e.message);
        }

        // 6.5 加载对话摘要
        const summaryData = loadSummary();
        let summaryPrompt = '';
        if (summaryData.summary && summaryData.updatedAt) {
            const hoursSinceUpdate = (Date.now() - new Date(summaryData.updatedAt).getTime()) / 3600000;
            if (hoursSinceUpdate < 24) {
                summaryPrompt = `\n\n【之前聊到的内容】\n${summaryData.summary}`;
            }
        }

        // 7. token 预算制：从新到旧回溯历史，保证最新对话一定保留
        //    预算 = contextTokens - 系统提示 - 相关记忆 - 摘要，剩下的全给历史
        //    轮数上限（contextRounds）只是硬顶，实际能装多少由 token 量决定
        const hasImage = !!image;
        const estimateTokens = (str) => {
            if (!str) return 0;
            if (typeof str !== 'string') str = String(str);
            const cjk = (str.match(/[\u3000-\u303f\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
            const other = str.length - cjk;
            // 中文约 1 token/字，英文约 0.35 token/字符，+4 作为单条消息开销
            return Math.ceil(cjk * 1.0 + other * 0.35) + 4;
        };

        const contextTokens = Math.min(
            parseInt(bodyContextTokens) || parseInt(process.env.CONTEXT_TOKENS) || loadSettings().contextTokens || 12000,
            24000
        );
        const systemTokens = estimateTokens(STATIC_SYSTEM_PROMPT)
            + (relevantMemoriesPrompt ? estimateTokens(relevantMemoriesPrompt) : 0);
        const summaryTokens = summaryPrompt ? estimateTokens(summaryPrompt) : 0;
        const historyBudget = Math.max(contextTokens - systemTokens - summaryTokens, 2000);

        let keptHistory = [];
        let usedTokens = 0;
        for (let i = recentHistory.length - 1; i >= 0; i--) {
            const h = recentHistory[i];
            const t = estimateTokens(h.content);
            if (usedTokens + t > historyBudget && keptHistory.length > 0) break;
            keptHistory.unshift(h);
            usedTokens += t;
        }

        const messages = [
            { role: 'system', content: STATIC_SYSTEM_PROMPT + relevantMemoriesPrompt },
        ];
        if (summaryPrompt && keptHistory.length >= 15) {
            messages.push({ role: 'system', content: summaryPrompt });
        }
        for (let i = 0; i < keptHistory.length; i++) {
            const h = keptHistory[i];
            if (h.role === 'user') {
                if (i === keptHistory.length - 1) {
                    const userContent = message;
                    if (hasImage) {
                        messages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: userContent },
                                { type: 'image_url', image_url: { url: image } }
                            ]
                        });
                    } else {
                        messages.push({ role: 'user', content: userContent });
                    }
                } else if (hasImage) {
                    messages.push({ role: 'user', content: h.content.replace(/^\[图片消息\]\s*/, '') });
                } else {
                    messages.push({ role: 'user', content: h.content });
                }
            } else if (h.role === 'assistant') {
                messages.push({ role: 'assistant', content: h.content });
            }
        }

        // 8. 调用 AI（带超时保护）
                const keptUserRounds = keptHistory.filter(h => h.role === 'user').length;
        // 告诉 ai.js 实际保留了多少轮，避免 trimContext 再把装进去的历史砍掉
        const opts = {
            temperature, topP, maxTokens,
            contextRounds: Math.max(keptUserRounds + 1, 3),
            onToolStart: (name, args, id) => {
                const label = '调用 ' + name;
                setStatus(label);
                sendEvent('status', { text: label });
                sendEvent('tool_start', { name, args: args || {}, id: id || null });
            },
            onToolEnd: (name, result, id) => {
                const label = '已完成 ' + name + '，继续分析中…';
                setStatus(label);
                sendEvent('tool_end', { name, result: String(result || ''), id: id || null });
                sendEvent('status', { text: label });
            }
        };
        const chatModel = hasImage ? 'deepseek-v4-flash-vision-exp' : model;
        setStatus('思考中…');
        const result = await withTimeout(
            chat(messages, chatModel, opts, true, hasImage),
            55000,
            'AI响应'
        );
        setStatus('');

        // 9. 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId });

        // 10. 异步更新对话摘要
        const updatedHistory = [
            ...keptHistory.slice(-3),
            { role: 'assistant', content: result.content }
        ];
        const newSummary = generateSummary(updatedHistory);
        if (newSummary) {
            saveSummary(newSummary);
        }

        // 11. 异步自动提取记忆
        const totalMessages = await Chat.countDocuments({ sessionId });
        // 自动记忆已停用（Rinka决定只保留人工选择的记忆，2026-07）
        // if (totalMessages % 5 === 0) {
        //     const allMessages = [
        //         ...recentHistory.map(h => ({ role: h.role, content: h.content })),
        //         { role: 'assistant', content: result.content }
        //     ];
        //     autoExtractMemories(allMessages).catch(e => {
        //         console.error('[自动记忆] 后台提取失败:', e.message);
        //     });
        // }

        // 12. 返回：先发最终结果，再结束 SSE
        // 12.1 表情包推荐（根据回复情绪匹配）
        let recommendedSticker = null;
        try {
            const { recommendSticker } = require('./sticker_recommend');
            const rec = await recommendSticker(result.content);
            recommendedSticker = rec.sticker;
            result.content = rec.content;
        } catch (e) {
            console.error('[表情包推荐] 失败:', e.message);
        }
        sendEvent('done', {
            reply: result.content,
            thinking: result.reasoning || '',
            usage: result.usage || null,
            toolCalls: result.toolCalls || [],
            sticker: recommendedSticker || null
        });
        res.end();

    } catch (err) {
        setStatus('');
        if (res.headersSent) {
            if (typeof sendEvent === 'function') {
                sendEvent('error', { error: err.message || '服务器错误' });
            }
            if (!res.writableEnded) res.end();
            return;
        }
        console.error('Chat error:', err.message);
        console.error('OpenRouter response:', err.response?.data);
        
        if (err.message && err.message.includes('超时')) {
            return res.status(503).json({ error: 'AI响应超时，请重试' });
        }
        
        const detail = err.response?.data?.error?.message || err.message;
        res.status(500).json({ error: detail || '服务器错误' });
    }
});

// 获取记忆列表
router.get('/memories', async (req, res) => {
    try {
        const mems = await Memory.find({}).sort({ timestamp: -1 }).lean();
        res.json(mems);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 清除记忆
router.delete('/memories', async (req, res) => {
    try {
        await Memory.deleteMany({});
        await Chat.deleteMany({});
        res.json({ message: '记忆和对话已清除' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取聊天历史
router.get('/history', async (req, res) => {
    try {
        const { sessionId = 'default' } = req.query;
        const history = await Chat.find({ sessionId })
            .sort({ timestamp: -1 }).limit(50).lean();
        res.json(history.reverse());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === 头像接口 ===
router.get('/avatars', async (req, res) => {
    try {
        const avatars = await Avatar.find({}).lean();
        const result = {};
        avatars.forEach(a => { result[a.key] = a.value; });
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/avatar', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key || !value) return res.status(400).json({ error: 'key 和 value 不能为空' });
        await Avatar.findOneAndUpdate(
            { key },
            { key, value },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/settings', async (req, res) => {
    try {
        const settings = loadSettings();
        if (!settings.systemPrompt) {
            settings.systemPrompt = '';
        }
        res.json(settings);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/settings', (req, res) => {
    try {
        const settings = req.body;
        const ok = saveSettings(settings);
        res.json({ success: ok });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/memories/:id', async (req, res) => {
    try {
        await Memory.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/debug/env', function(req, res) {
    res.json({
        hasZhipuKey: !!process.env.ZHIPUAI_API_KEY,
        keyLength: (process.env.ZHIPUAI_API_KEY || '').length,
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
        nodeEnv: process.env.NODE_ENV || ''
    });
});

module.exports = router;
