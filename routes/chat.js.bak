const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const Chat = require('../models/Chat');
const Memory = require('../models/Memory');
const Avatar = require('../models/Avatar');
const { chat, SYSTEM_PROMPT, loadSettings, saveSettings } = require('../services/ai');
const { searchMemories, storeMemory, autoExtractMemories, getChatMemories } = require('../services/memory');

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
        const { message, sessionId = 'default', model, temperature, topP, maxTokens, image } = req.body;
        if (!message && !image) return res.status(400).json({ error: '消息不能为空' });

        // 1. 存用户消息（去重：30秒内相同内容不重复存储）
        // 有图片时存文字描述，不存图片base64（太长且5.2看不了）
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
            .sort({ timestamp: -1 }).limit(15).lean();
        const recentHistory = history.reverse();

        // 3. 用最近几条消息拼接做记忆搜索（不只是当前消息）
        const recentMessages = recentHistory.slice(-4).map(h => h.content).join(' ');
        const memories = await getChatMemories("default", recentMessages, 10);
        let memoryContext = '';
        if (memories.length > 0) {
            const critical = memories.filter(m => m.priority === 'critical');
            const others = memories.filter(m => m.priority !== 'critical');
            
            memoryContext = '\n\n【记忆】\n';
            
            if (critical.length > 0) {
                memoryContext += '⚠️ 核心记忆（必须牢记）：\n';
                critical.forEach(m => { memoryContext += `- ${m.content}\n`; });
            }
            
            if (others.length > 0) {
                memoryContext += '相关记忆：\n';
                others.forEach(m => { memoryContext += `- ${m.content}\n`; });
            }
        }

        // 4. 构建系统提示（含记忆）
        let systemPrompt = SYSTEM_PROMPT;
        if (memoryContext) systemPrompt += memoryContext;

        // 5. 构建消息数组
        // 有图片时，最后一条用户消息用多模态格式，历史中的图片消息只保留文字描述
        const hasImage = !!image;
        const messages = [{ role: 'system', content: systemPrompt }];
        for (let i = 0; i < recentHistory.length; i++) {
            const h = recentHistory[i];
            if (h.role === 'user') {
                // 最后一条用户消息且有图片时，构建多模态消息
                if (i === recentHistory.length - 1 && hasImage) {
                    messages.push({
                        role: 'user',
                        content: [
                            { type: 'text', text: message || '请描述这张图片' },
                            { type: 'image_url', image_url: { url: image } }
                        ]
                    });
                } else {
                    messages.push({ role: 'user', content: h.content });
                }
            } else if (h.role === 'assistant') {
                messages.push({ role: 'assistant', content: h.content });
            }
        }

        // 6. 调用 AI（有图片时强制用glm-4.6v，禁用工具调用）
        const opts = { temperature, topP, maxTokens };
        const chatModel = hasImage ? 'glm-4.6v' : model;
        const result = await chat(messages, chatModel, opts, true, hasImage);

        // 7. 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId });

        // 8. 异步自动提取记忆（每5条消息才触发一次，省token）
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
// 获取所有头像
router.get('/avatars', async (req, res) => {
    try {
        const avatars = await Avatar.find({}).lean();
        const result = {};
        avatars.forEach(a => { result[a.key] = a.value; });
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 保存/更新头像
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
router.post('/settings', (req, res) => {
    try {
        const settings = req.body;
        const ok = saveSettings(settings);
        res.json({ success: ok });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// 删除单条记忆
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
