const express = require('express');
const router = express.Router();
const Calendar = require('../models/Calendar');

// 获取某月所有事件
router.get('/', async (req, res) => {
    try {
        const { month } = req.query; // YYYY-MM
        const sessionId = req.query.sessionId || 'default';
        const query = { sessionId };
        if (month) {
            const start = month + '-01';
            const end = month + '-31';
            query.date = { $gte: start, $lte: end };
        }
        const events = await Calendar.find(query).sort({ date: 1, createdAt: 1 }).lean();
        res.json(events);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 添加事件
router.post('/', async (req, res) => {
    try {
        const { date, title, color, sessionId = 'default' } = req.body;
        if (!date || !title) return res.status(400).json({ error: '日期和标题不能为空' });
        const event = await Calendar.create({ date, title, color: color || '#f5a0b8', sessionId });
        res.json(event);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除事件
router.delete('/:id', async (req, res) => {
    try {
        await Calendar.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
