const express = require('express');
const router = express.Router();
const LumiJournal = require('../models/LumiJournal');

// GET /api/journal - 获取日志列表
router.get('/', async (req, res) => {
    try {
        const { sessionId = 'default', type, limit = 20, toRinka } = req.query;
        const query = { sessionId };
        if (type) query.type = type;
        if (toRinka === 'true') query.toRinka = true;
        else if (toRinka === 'false') query.toRinka = false;

        const entries = await LumiJournal.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        res.json({ success: true, data: entries });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/journal - 写日志
router.post('/', async (req, res) => {
    try {
        const { sessionId, type, content, mood, toRinka, relatedMemoryId } = req.body;
        if (!content) {
            return res.status(400).json({ success: false, error: '内容不能为空' });
        }

        const entry = await LumiJournal.create({
            sessionId: sessionId || 'default',
            type: type || '情绪',
            content,
            mood: mood || null,
            toRinka: toRinka !== false,
            relatedMemoryId: relatedMemoryId || null
        });

        res.json({ success: true, data: entry });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/journal/latest - 获取最新条目
router.get('/latest', async (req, res) => {
    try {
        const { sessionId = 'default' } = req.query;
        const entry = await LumiJournal.findOne({ sessionId })
            .sort({ createdAt: -1 })
            .lean();
        res.json({ success: true, data: entry });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/journal/:id - 删除
router.delete('/:id', async (req, res) => {
    try {
        await LumiJournal.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
