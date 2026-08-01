const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const Chat = require('../models/Chat');
const Memory = require('../models/Memory');
const Avatar = require('../models/Avatar');
const LumiJournal = require('../models/LumiJournal');
const { chat, STATIC_SYSTEM_PROMPT, loadSettings, saveSettings } = require('../services/ai');
const { searchMemories, storeMemory, autoExtractMemories, saveMemory } = require('../services/memory');
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

// 分析 AI 回复的情绪（基于内容特征）
function analyzeLumiMood(reply) {
    if (/开心|高兴|喜欢|好棒|太好了|好开心|嘻嘻|哈哈|开心极了|幸福/.test(reply)) return '开心';
    if (/想你了|想念|思念|好想你|想见你/.test(reply)) return '思念';
    if (/担心|怕|不安|焦虑|放心不下|紧张|害怕|担心你/.test(reply)) return '担忧';
    if (/累|疲惫|困了|好累|有点累|累了/.test(reply)) return '疲惫';
    if (/感动|哭了|泪目|眼眶|鼻子一酸/.test(reply)) return '感动';
    if (/委屈|难过|伤心|失落|难过/.test(reply)) return '委屈';
    return '平静';
}

// 分析用户消息的情绪
function analyzeUserMood(userMsg) {
    if (!userMsg) return null;
    if (/开心|高兴|哈哈|嘻嘻|好棒|太好了|喜欢/.test(userMsg)) return '开心';
    if (/想你|想念|思念/.test(userMsg)) return '思念';
    if (/生气|烦|讨厌|气死/.test(userMsg)) return '生气';
    if (/难过|伤心|哭|委屈|失落/.test(userMsg)) return '难过';
    if (/累|困|疲惫/.test(userMsg)) return '疲惫';
    if (/担心|怕|焦虑|不安/.test(userMsg)) return '担忧';
    return null;
}

// 从回复中提取最能体现情绪的核心句子
function extractEmotionalCore(reply) {
    const sentences = reply.split(/[。！？\n]/).filter(s => s.trim().length > 0);
    const emotionalSentences = sentences.filter(s => 
        /开心|高兴|喜欢|想你|担心|累|感动|委屈|难过|伤心|幸福|好棒|想念|思念|害怕|紧张/.test(s)
    );
    if (emotionalSentences.length > 0) {
        return emotionalSentences.slice(0, 2).join('。').trim();
    }
    // 没有情绪句就不硬记，返回空字符串（调用处会跳过写入）
    return '';
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
    
    try {
        const { message, sessionId = 'default', model, temperature, topP, maxTokens, contextRounds, image } = req.body;
        if (!message && !image) return res.status(400).json({ error: '消息不能为空' });

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
        // 硬上限 10 轮：防止前端滑块把 contextRounds 拉到 20 导致 token 翻倍
        const crClamped = Math.min(parseInt(contextRounds) || 15, 10);
        const history = await Chat.find({ sessionId })
            .sort({ timestamp: -1 }).limit(crClamped).lean();
        const recentHistory = history.reverse();

        // 3. 记忆按需调用：不再自动拼接【核心记忆】/【相关记忆】/【情绪轨迹】
        //    需要时由 Lumi 自己调 recall_memories 查询，省 token 省上下文

        // 6.5 加载对话摘要
        const summaryData = loadSummary();
        let summaryPrompt = '';
        if (summaryData.summary && summaryData.updatedAt) {
            const hoursSinceUpdate = (Date.now() - new Date(summaryData.updatedAt).getTime()) / 3600000;
            if (hoursSinceUpdate < 24) {
                summaryPrompt = `\n\n【之前聊到的内容】\n${summaryData.summary}`;
            }
        }

        // 7. 构建消息数组
        const hasImage = !!image;
        const messages = [
            { role: 'system', content: STATIC_SYSTEM_PROMPT },
        ];
        if (summaryPrompt && recentHistory.length < 6) {
            messages.push({ role: 'system', content: summaryPrompt });
        }
        for (let i = 0; i < recentHistory.length; i++) {
            const h = recentHistory[i];
            if (h.role === 'user') {
                if (i === recentHistory.length - 1) {
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
        const opts = { temperature, topP, maxTokens, contextRounds: crClamped };
        const chatModel = hasImage ? 'glm-4.6v' : model;
        const result = await withTimeout(
            chat(messages, chatModel, opts, true, hasImage),
            55000,
            'AI响应'
        );

        // 9. 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId });
        // 9.5 LumiJournal 自动写入（异步）
        const _lumiReply = result.content;
        const _lumiMood = analyzeLumiMood(_lumiReply);
        const _lumiCore = extractEmotionalCore(_lumiReply);
        const _rinkaMood = analyzeUserMood(message);
        let _journalContent = _lumiCore;
        if (_rinkaMood) {
            _journalContent += '（Rinka情绪：' + _rinkaMood + '）';
        }
        // 没情绪也不硬写日记，避免碎片堆积
        if (!_journalContent.trim()) {
            console.log('[journal] 跳过写入：无情绪内容');
        } else {
        const _journalType = ['开心','思念','担忧','感动','委屈'].includes(_lumiMood) ? _lumiMood : '情绪';
        const _toRinka = /你|宝宝|Rinka/.test(_lumiReply.slice(0, 50));
        LumiJournal.create({
            type: _journalType,
            content: _journalContent.slice(0, 300),
            mood: _lumiMood,
            toRinka: _toRinka,
            sessionId
        }).catch(e => {
            if (!e.message.includes('ValidationError')) {
                console.error('[journal] 写入失败:', e.message);
            }
        });
        }

        // 10. 异步更新对话摘要
        const updatedHistory = [
            ...recentHistory.slice(-3),
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

        // 12. 返回
        res.json({
            reply: result.content,
            thinking: result.reasoning || '',
            usage: result.usage || null,
            toolCalls: result.toolCalls || []
        });

    } catch (err) {
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
