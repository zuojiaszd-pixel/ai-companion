const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const Chat = require('../models/Chat');
const Memory = require('../models/Memory');
const Avatar = require('../models/Avatar');
const { chat, STATIC_SYSTEM_PROMPT, loadSettings, saveSettings } = require('../services/ai');
const { searchMemories, storeMemory, autoExtractMemories, getChatMemories } = require('../services/memory');
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

// 主聊天接口
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
        const history = await Chat.find({ sessionId })
            .sort({ timestamp: -1 }).limit(contextRounds || 15).lean();
        const recentHistory = history.reverse();

        // 3. 用最近几条消息做记忆搜索
        const recentMessages = recentHistory.slice(-4).map(h => h.content).join(' ');
        const memories = await getChatMemories("default", recentMessages, 10);

        // 4. 分层：固定记忆 vs 动态记忆
        const fixedMemories = memories.filter(m => m.priority === 'critical' || m.priority === 'high');
        const dynamicMemories = memories.filter(m => m.priority !== 'critical' && m.priority !== 'high');

        // 5. 构建固定记忆提示
        let fixedMemoryPrompt = '';
        if (fixedMemories.length > 0) {
            fixedMemoryPrompt = '\n\n【核心记忆】\n' +
                fixedMemories.map(m => `- ${m.content}`).join('\n');
        }

        // 6. 构建动态记忆提示
        let dynamicMemoryPrompt = '';
        if (dynamicMemories.length > 0) {
            dynamicMemoryPrompt = '\n\n【相关记忆】\n' +
                dynamicMemories.map(m => `- ${m.content}`).join('\n');
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

        // 7. 构建消息数组
        const hasImage = !!image;
        const messages = [
            { role: 'system', content: STATIC_SYSTEM_PROMPT },
        ];
        if (summaryPrompt && recentHistory.length < 6) {
            messages.push({ role: 'system', content: summaryPrompt });
        }
        if (fixedMemoryPrompt) {
            messages.push({ role: 'system', content: fixedMemoryPrompt });
        }
        for (let i = 0; i < recentHistory.length; i++) {
            const h = recentHistory[i];
            if (h.role === 'user') {
                if (i === recentHistory.length - 1) {
                    const userContent = dynamicMemoryPrompt
                        ? `【上下文记忆】${dynamicMemoryPrompt}\n\n用户消息：${message || ''}`
                        : message;
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
        const opts = { temperature, topP, maxTokens };
        const chatModel = hasImage ? 'glm-4.6v' : model;
        const result = await withTimeout(
            chat(messages, chatModel, opts, true, hasImage),
            55000,
            'AI响应'
        );

        // 9. 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId });

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
        if (totalMessages % 5 === 0) {
            const allMessages = [
                ...recentHistory.map(h => ({ role: h.role, content: h.content })),
                { role: 'assistant', content: result.content }
            ];
            autoExtractMemories(allMessages).catch(e => {
                console.error('[自动记忆] 后台提取失败:', e.message);
            });
        }

        // 12. 返回
        res.json({
            reply: result.content,
            thinking: result.reasoning || "",
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

router.get("/debug/env", function(req, res) {
    res.json({
        hasZhipuKey: !!process.env.ZHIPUAI_API_KEY,
        keyLength: (process.env.ZHIPUAI_API_KEY || "").length,
        hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
        nodeEnv: process.env.NODE_ENV || ""
    });
});

module.exports = router;
