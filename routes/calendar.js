const express = require('express');
const router = express.Router();
const Calendar = require('../models/Calendar');

// 获取事件/任务或备忘录
// GET /?month=YYYY-MM&type=event|memo
// 事件按月份过滤；备忘录不过滤月份，按未完成在前、创建时间排序
router.get('/', async (req, res) => {
    try {
        const { month, type } = req.query;
        const sessionId = req.query.sessionId || 'default';
        const query = { sessionId };
        if (type) query.type = type;
        if (month && (!type || type === 'event')) {
            const start = month + '-01';
            const end = month + '-31';
            query.date = { $gte: start, $lte: end };
        }
        const items = type === 'memo'
            ? await Calendar.find(query).sort({ done: 1, createdAt: -1 }).lean()
            : await Calendar.find(query).sort({ date: 1, createdAt: 1 }).lean();
        res.json(items);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 添加事件/任务/备忘录
// body: { date, title, color, type }
router.post('/', async (req, res) => {
    try {
        const { date, title, color, type, sessionId = 'default' } = req.body;
        if (!title) return res.status(400).json({ error: '标题不能为空' });
        const kind = type === 'memo' ? 'memo' : 'event';
        // 备忘录没给日期就默认今天（当作创建日，方便排序展示）
        const d = date || (kind === 'memo' ? new Date().toISOString().slice(0, 10) : undefined);
        if (!d) return res.status(400).json({ error: '日期不能为空' });
        const event = await Calendar.create({ date: d, title, color: color || '#f5a0b8', type: kind, done: false, sessionId });
        res.json(event);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新事件/任务/备忘录（完成状态、标题、颜色、类型）
router.patch('/:id', async (req, res) => {
    try {
        const { done, title, color, type } = req.body;
        const update = {};
        if (typeof done === 'boolean') {
            update.done = done;
            update.doneAt = done ? new Date() : null;
        }
        if (title) update.title = title;
        if (color) update.color = color;
        if (type === 'event' || type === 'memo') update.type = type;
        const event = await Calendar.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!event) return res.status(404).json({ error: '事件不存在' });
        res.json(event);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除事件/任务/备忘录
router.delete('/:id', async (req, res) => {
    try {
        await Calendar.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
