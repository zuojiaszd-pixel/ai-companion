const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Memory = require('../models/Memory');
const { chat, SYSTEM_PROMPT, loadSettings, saveSettings } = require('../services/ai');
const { searchMemories, storeMemory } = require('../services/memory');

// 主聊天接口
router.post('/chat', async (req, res) => {
    try {
        const { message, sessionId = 'default', model, temperature, topP, maxTokens } = req.body;
        if (!message) return res.status(400).json({ error: '消息不能为空' });

        // 1. 存用户消息
        await Chat.create({ role: 'user', content: message, sessionId });

        // 2. 搜索相关记忆
        const memories = await searchMemories(message);
        let memoryContext = '';
        if (memories.length > 0) {
            memoryContext = '\n\n【相关记忆】\n' + memories.map(m => `- ${m.content}`).join('\n');
        }

        // 3. 构建系统提示（含记忆）
        let systemPrompt = SYSTEM_PROMPT;
        if (memoryContext) systemPrompt += memoryContext;

        // 4. 加载最近对话历史（最近20条）
        const history = await Chat.find({ sessionId })
            .sort({ timestamp: -1 }).limit(20).lean();
        const recentHistory = history.reverse();

        // 5. 构建消息数组
        const messages = [{ role: 'system', content: systemPrompt }];
        for (const h of recentHistory) {
            if (h.role === 'user') messages.push({ role: 'user', content: h.content });
            else if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.content });
        }
        // 添加当前用户消息（如果不在历史中）
        const lastMsg = recentHistory[recentHistory.length - 1];
        if (!lastMsg || lastMsg.content !== message) {
            messages.push({ role: 'user', content: message });
        }

        // 6. 调用 AI
        const opts = { temperature, topP, maxTokens };
        const result = await chat(messages, model, opts);

        // 7. 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId });

        // 8. 提取重要信息存为记忆（用户说了关键信息时）
        const keyPhrases = ['我叫', '我喜欢', '我在做', '我是', '我的项目', '我遇到', '我想要', '我需要'];
        if (keyPhrases.some(k => message.includes(k))) {
            storeMemory(sessionId, message, 'fact');
        }

        // 9. 返回（含思考和token用量）
        res.json({
            reply: result.content,
            thinking: result.reasoning || "",
            usage: result.usage || null
        });

    } catch (err) {
        console.error('Chat error:', err.message);
        console.error('OpenRouter response:', err.response?.data);
        const detail = err.response?.data?.error?.message || err.message;
        res.status(500).json({ error: detail || '服务器错误' });
    }
});

// 获取记忆列表
router.get('/memories', async (req, res) => {
    try {
        const mems = await Memory.find({}).sort({ timestamp: -1 }).limit(50).lean();
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

// 获取设置
router.get('/settings', async (req, res) => {
    try {
        const settings = loadSettings();
        // If systemPrompt is null/empty, return the default
        if (!settings.systemPrompt) {
            settings.systemPrompt = '';
        }
        res.json(settings);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新设置
router.post('/settings', async (req, res) => {
    try {
        const settings = req.body;
        const ok = saveSettings(settings);
        res.json({ success: ok });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;