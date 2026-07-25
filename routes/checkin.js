const express = require('express');
const router = express.Router();
const { triggerCheckin } = require('../services/checkin');

// 外部 cron 触发 checkin
router.post('/checkin', async (req, res) => {
    const result = await triggerCheckin();
    res.json(result);
});

// 简单健康检查
router.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

module.exports = router;
