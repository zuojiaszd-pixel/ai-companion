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

// 主聊天接口
router.post('/chat', async (req, res) => {
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

        // 2. 加载最近对话历史（最近15条，省token）
        const history = await Chat.find({ sessionId })
            .sort({ timestamp: -1 }).limit(contextRounds || 15).lean();
        const recentHistory = history.reverse();

        // 3. 用最近几条消息拼接做记忆搜索
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

        // 6.5 加载对话摘要（用于模型切换时恢复上下文）
        const summaryData = loadSummary();
        let summaryPrompt = '';
        if (summaryData.summary && summaryData.updatedAt) {
            const hoursSinceUpdate = (Date.now() - new Date(summaryData.updatedAt).getTime()) / 3600000;
            // 只注入24小时内的摘要，太旧的可能已经无关了
            if (hoursSinceUpdate < 24) {
                summaryPrompt = `\n\n【之前聊到的内容】\n${summaryData.summary}`;
            }
        }

        // 7. 构建消息数组
        const hasImage = !!image;
        const messages = [
            { role: 'system', content: STATIC_SYSTEM_PROMPT },
        ];
        // 注入对话摘要（如果有且历史少于3条，说明可能是新模型启动，摘要尤为重要）
        if (summaryPrompt && recentHistory.length < 6) {
            messages.push({ role: 'system', content: summaryPrompt });
        }
        // 固定记忆
        if (fixedMemoryPrompt) {
            messages.push({ role: 'system', content: fixedMemoryPrompt });
        }
        // 历史对话
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

        // 8. 调用 AI
        const opts = { temperature, topP, maxTokens };
        const chatModel = hasImage ? 'glm-4.6v' : model;
        const result = await chat(messages, chatModel, opts, true, hasImage);

        // 9. 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId });

        // 10. 异步更新对话摘要（每轮都更新，覆盖旧摘要）
        const updatedHistory = [
            ...recentHistory.slice(-3),
            { role: 'assistant', content: result.content }
        ];
        const newSummary = generateSummary(updatedHistory);
        if (newSummary) {
            saveSummary(newSummary);
        }

        // 11. 异步自动提取记忆（每5条触发一次）
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
