const express = require('express');
const router = express.Router();
const Sticker = require('../models/Sticker');

// 获取表情包列表（可按情绪筛选）
router.get('/stickers', async (req, res) => {
  try {
    const { emotion } = req.query;
    const filter = {};
    if (emotion) filter.emotion = emotion;
    const stickers = await Sticker.find(filter).sort({ createdAt: -1 }).lean();
    res.json(stickers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 上传表情包
router.post('/stickers', async (req, res) => {
  try {
    const { name, note = '', emotion = '其他', data, type = 'upload' } = req.body;
    if (!name) return res.status(400).json({ error: '名字不能为空' });
    if (!data) return res.status(400).json({ error: '图片数据不能为空' });
    const sticker = await Sticker.create({ name, note, emotion, type, data });
    res.json(sticker);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除表情包
router.delete('/stickers/:id', async (req, res) => {
  try {
    await Sticker.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
