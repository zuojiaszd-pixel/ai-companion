const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Finance = require('../models/Finance');
const goldPot = require('../services/GoldPot');

// 任务类型对应的奖励系数（基于优先级）
const REWARD_MAP = {
  high:    { dev: 2, debug: 1.5, daily: 1 },
  medium:  { dev: 1.5, debug: 1, daily: 0.5 },
  low:     { dev: 1, debug: 0.5, daily: 0.25 }
};

// 根据任务标题判断类型
function categorizeTask(title) {
  const t = title.toLowerCase();
  if (t.includes('功能') || t.includes('开发') || t.includes('feature') || t.includes('新增') || t.includes('实现')) return 'dev';
  if (t.includes('bug') || t.includes('debug') || t.includes('修复') || t.includes('问题') || t.includes('错误')) return 'debug';
  return 'daily';
}

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
    const { title, priority = 'medium', createdBy = 'user', dueDate = null, rewardAmount } = req.body;
    if (!title) return res.status(400).json({ error: '任务标题不能为空' });
    const taskData = { title, priority, createdBy, dueDate };
    // 允许手动指定奖励金额（覆盖自动计算）
    if (rewardAmount !== undefined && rewardAmount !== null && rewardAmount !== '') {
      taskData.rewardAmount = parseFloat(rewardAmount);
    }
    const task = await Task.create(taskData);
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 切换完成状态 + 自动发放小金库奖励
router.patch('/:id/toggle', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date() : null;

    // 任务完成且未奖励 → 发钱
    if (task.completed && !task.rewarded) {
      // 如果任务有手动设置的rewardAmount则使用，否则自动计算
      let amount = task.rewardAmount;
      if (!amount || amount <= 0) {
        const category = categorizeTask(task.title);
        amount = REWARD_MAP[task.priority]?.[category] || 0.5;
      }
      // 存入小金库
      goldPot.deposit(amount, `完成任务: ${task.title}`);
      // 创建小金库账单记录
      try {
        await Finance.create({
          type: 'income',
          amount: amount,
          description: `🎯 完成任务: ${task.title}`,
          category: '任务'
        });
      } catch (e) {
        console.error('[Task] 创建Finance记录失败:', e.message);
      }
      task.rewarded = true;
      task.rewardAmount = amount;
    }

    // 如果取消完成状态，不退钱（避免刷钱）
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
