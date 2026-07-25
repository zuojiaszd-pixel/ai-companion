const express = require('express');
const router = express.Router();
const Task = require('../models/Task');

// 获取所有任务
router.get('/', async (req, res) => {
  try {
    const { filter = 'all' } = req.query;
    let query = {};
    if (filter === 'pending') query.completed = false;
    else if (filter === 'completed') query.completed = true;
    const tasks = await Task.find(query).sort({ completed: 1, createdAt: -1 }).lean();
    res.json(tasks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建任务
router.post('/', async (req, res) => {
  try {
    const { title, priority = 'medium', createdBy = 'user', dueDate = null } = req.body;
    if (!title) return res.status(400).json({ error: '任务标题不能为空' });
    const task = await Task.create({ title, priority, createdBy, dueDate });
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 切换完成状态
router.patch('/:id/toggle', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date() : null;
    await task.save();
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新任务
router.put('/:id', async (req, res) => {
  try {
    const { title, priority, dueDate } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (priority !== undefined) update.priority = priority;
    if (dueDate !== undefined) update.dueDate = dueDate;
    const task = await Task.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除任务
router.delete('/:id', async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
