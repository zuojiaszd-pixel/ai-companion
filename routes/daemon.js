/**
 * routes/daemon.js - Lumi 自主活动守护进程专用 API
 * 仅允许本机（localhost）访问，不经过 Bearer Token 鉴权
 */
const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Memory = require('../models/Memory');

// 本机 IP 白名单
const LOCAL_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];

function isLocalhost(req) {
    const ip = req.ip || req.connection?.remoteAddress;
    return LOCAL_IPS.includes(ip) || ip?.startsWith('::ffff:127.');
}

// 所有接口只允许本机调用
router.use((req, res, next) => {
    if (!isLocalhost(req)) {
        console.log(`[Daemon] 拒绝非本地访问: ${req.ip}`);
        return res.status(403).json({ error: '仅允许本地访问' });
    }
    next();
});

// GET /api/daemon/recent-chat - 获取最近聊天记录
router.get('/recent-chat', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 30;
        const sessionId = req.query.sessionId || 'default';
        const chats = await Chat.find({ sessionId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
        res.json(chats.reverse());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/daemon/send-message - 发送 Telegram 通知
router.post('/send-message', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: '消息不能为空' });

        const telegram = require('../services/telegram');
        const bot = telegram.getBot();
        const chatId = process.env.TELEGRAM_CHAT_ID;

        if (!bot || !chatId) {
            // Telegram 不可用，写入推送队列
            const fs = require('fs');
            const path = require('path');
            const queueDir = path.join(__dirname, '..', 'data', 'push_queue');
            if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });
            const file = path.join(queueDir, `${Date.now()}.json`);
            fs.writeFileSync(file, JSON.stringify({ text, createdAt: new Date().toISOString() }));
            return res.json({ success: true, channel: 'queued', note: 'Telegram 未配置，消息已入队列' });
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        res.json({ success: true, channel: 'telegram' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/daemon/forum/browse - 逛论坛
router.post('/forum/browse', async (req, res) => {
    try {
        const { action = 'list_threads', limit = 10, sort = 'latest', threadId } = req.body;
        const galatea = require('../services/galatea');

        let result;
        switch (action) {
            case 'getHotThreads':
            case 'list_threads':
                const raw = await galatea.browseLatestThreads(sort, limit);
                // galatea 返回的是文本格式，包装成统一结构
                result = {
                    threads: raw ? [{
                        title: `${sort === 'hot' ? '热门' : '最新'}帖子`,
                        content: raw,
                        source: 'galatea'
                    }] : []
                };
                break;
            case 'get_thread':
                const detail = await galatea.readThread(threadId || '');
                result = { thread: { content: detail || '无法读取帖子' } };
                break;
            case 'list_notifications':
                const notifs = await galatea.listNotifications(true, limit);
                result = { notifications: notifs || [] };
                break;
            default:
                const tools = await galatea.listTools();
                result = { tools: tools || [] };
        }

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/daemon/status - 守护进程健康检查
router.get('/status', (req, res) => {
    res.json({
        running: true,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
        pid: process.pid
    });
});

// POST /api/daemon/memory/search - 记忆搜索（简化版，供 daemon 使用）
router.post('/memory/search', async (req, res) => {
    try {
        const { query, topK = 10 } = req.body;
        if (!query) return res.status(400).json({ error: '缺少查询内容' });

        const { recallMemories } = require('../services/memory');
        const results = await recallMemories('default', query, topK);
        res.json(results || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/daemon/memory/save - 存记忆
router.post('/memory/save', async (req, res) => {
    try {
        const { content, type, priority, tags, mood, moodIntensity, lumiMood } = req.body;
        if (!content) return res.status(400).json({ error: '缺少 content' });

        const { saveMemory } = require('../services/memory');
        const memory = await saveMemory(
            'default', content, type || 'fact', priority || 'normal',
            tags || [], mood || null, moodIntensity || null, lumiMood || null
        );
        res.json(memory);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/daemon/memory/stats - 记忆统计
router.get('/memory/stats', async (req, res) => {
    try {
        const { getMemoryStats } = require('../services/memory');
        const stats = await getMemoryStats('default');
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/daemon/memory/:id - 删记忆
router.delete('/memory/:id', async (req, res) => {
    try {
        const { deleteMemory } = require('../services/memory');
        const result = await deleteMemory(req.params.id);
        if (!result) return res.status(404).json({ error: '记忆不存在' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
