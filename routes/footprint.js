const express = require('express');
const router = express.Router();
const Footprint = require('../models/Footprint');

// 获取所有足迹（按时间倒序）
router.get('/', async (req, res) => {
  try {
    const footprints = await Footprint.find().sort({ timestamp: -1 }).lean();
    res.json(footprints);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建足迹
router.post('/', async (req, res) => {
  try {
    const { title, thought = '', mcp = '' } = req.body;
    if (!title) return res.status(400).json({ error: '标题不能为空' });
    const fp = await Footprint.create({ title, thought, mcp });
    res.json(fp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除足迹
router.delete('/:id', async (req, res) => {
  try {
    await Footprint.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
