const express = require('express');
const router = express.Router();
const Finance = require('../models/Finance');

// 获取所有账单 + 统计
router.get('/', async (req, res) => {
  try {
    const records = await Finance.find().sort({ date: -1 }).lean();
    const stats = {
      total: 0,
      income: 0,
      expense: 0,
      count: records.length
    };
    records.forEach(r => {
      if (r.type === 'income') stats.income += r.amount;
      else stats.expense += r.amount;
    });
    stats.total = stats.income - stats.expense;
    res.json({ records, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 记账（收入/支出）
router.post('/', async (req, res) => {
  try {
    const { type, amount, description, category = '其他' } = req.body;
    if (!type || !['income', 'expense'].includes(type)) return res.status(400).json({ error: '类型必须是 income 或 expense' });
    if (!amount || amount <= 0) return res.status(400).json({ error: '金额必须大于0' });
    if (!description) return res.status(400).json({ error: '事由不能为空' });
    const record = await Finance.create({ type, amount, description, category });
    res.json(record);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除账单
router.delete('/:id', async (req, res) => {
  try {
    await Finance.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置攒钱目标（暂存内存里，可以改进）
let savingsGoal = { target: 100, current: 0 };

router.get('/goal', (req, res) => {
  res.json(savingsGoal);
});

router.put('/goal', (req, res) => {
  const { target } = req.body;
  if (target && target > 0) savingsGoal.target = target;
  res.json(savingsGoal);
});

module.exports = router;
