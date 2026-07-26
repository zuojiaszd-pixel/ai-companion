const express = require('express');
const router = express.Router();
const memoryService = require('../services/memory');

// GET /api/memory - 记忆列表（分页+筛选+排序）
router.get('/', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || 'default';
        const options = {
            type: req.query.type,
            priority: req.query.priority,
            sort: req.query.sort || 'recent',
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 20
        };
        const memories = await memoryService.listMemories(sessionId, options);
        res.json({ success: true, data: memories });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/memory/search - 搜索记忆
router.get('/search', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || 'default';
        const query = req.query.q || '';
        const topK = parseInt(req.query.topK) || 10;
        if (!query) {
            return res.status(400).json({ success: false, error: '缺少查询参数 q' });
        }
        const results = await memoryService.recallMemories(sessionId, query, topK);
        res.json({ success: true, data: results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/memory/stats - 统计信息
router.get('/stats', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || 'default';
        const stats = await memoryService.getMemoryStats(sessionId);
        res.json({ success: true, data: stats });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/memory/dream/log - Dream日志（简单返回最近运行信息）
router.get('/dream/log', async (req, res) => {
    try {
        // 如果有日志文件就读取，没有就返回空
        const fs = require('fs');
        const logPath = './data/dream_log.json';
        if (fs.existsSync(logPath)) {
            const logs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
            res.json({ success: true, data: logs });
        } else {
            res.json({ success: true, data: [] });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/memory/dream/run - 手动触发Dream整理
router.post('/dream/run', async (req, res) => {
    try {
        const sessionId = req.body.sessionId || 'default';
        const log = await memoryService.runDream(sessionId);
        
        // 保存日志
        const fs = require('fs');
        const path = require('path');
        const dir = './data';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logPath = './data/dream_log.json';
        let logs = [];
        if (fs.existsSync(logPath)) {
            logs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
        }
        logs.push(log);
        // 只保留最近50条
        if (logs.length > 50) logs = logs.slice(-50);
        fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
        
        res.json({ success: true, data: log });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/memory - 手动添加记忆
router.post('/', async (req, res) => {
    try {
        const { sessionId, content, type, priority, tags } = req.body;
        if (!content) {
            return res.status(400).json({ success: false, error: '缺少 content' });
        }
        const memory = await memoryService.saveMemory(
            sessionId || 'default',
            content,
            type || 'fact',
            priority || 'normal',
            tags || []
        );
        res.json({ success: true, data: memory });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PUT /api/memory/:id - 编辑记忆
router.put('/:id', async (req, res) => {
    try {
        const Memory = require('../models/Memory');
        const updates = {};
        const allowed = ['content', 'type', 'priority', 'tags', 'locked'];
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        updates.updatedAt = new Date();
        
        // 如果content改了，重新生成embedding
        if (updates.content) {
            const axios = require('axios');
            const res2 = await axios.post('https://open.bigmodel.cn/api/paas/v4/embeddings', {
                model: 'embedding-3',
                input: updates.content
            }, {
                headers: {
                    'Authorization': 'Bearer ' + process.env.ZHIPUAI_API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            updates.embedding = res2.data.data[0].embedding;
        }
        
        const memory = await Memory.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!memory) {
            return res.status(404).json({ success: false, error: '记忆不存在' });
        }
        res.json({ success: true, data: memory });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/memory/:id/lock - 锁定记忆
router.post('/:id/lock', async (req, res) => {
    try {
        const memory = await memoryService.lockMemory(req.params.id);
        if (!memory) {
            return res.status(404).json({ success: false, error: '记忆不存在' });
        }
        res.json({ success: true, data: memory });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/memory/:id/unlock - 解锁记忆
router.post('/:id/unlock', async (req, res) => {
    try {
        const memory = await memoryService.unlockMemory(req.params.id);
        if (!memory) {
            return res.status(404).json({ success: false, error: '记忆不存在' });
        }
        res.json({ success: true, data: memory });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/memory/:id - 删除记忆
router.delete('/:id', async (req, res) => {
    try {
        const memory = await memoryService.deleteMemory(req.params.id);
        if (!memory) {
            return res.status(404).json({ success: false, error: '记忆不存在' });
        }
        res.json({ success: true, message: '已删除' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;