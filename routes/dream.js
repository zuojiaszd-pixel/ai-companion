const express = require('express');
const router = express.Router();
const dreamScheduler = require('../services/dreamScheduler');

// 获取Dream整理状态
router.get('/dream/status', (req, res) => {
  const status = dreamScheduler.getStatus();
  res.json({ success: true, ...status });
});

// 手动触发全量Dream整理
router.post('/dream/run', async (req, res) => {
  try {
    const result = await dreamScheduler.runDreamTask();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 手动触发记忆提取（轻量级）
router.post('/dream/extract', async (req, res) => {
  try {
    const result = await dreamScheduler.runExtractOnly();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
