const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const telegram = require('./services/telegram');
const { initCheckin } = require('./services/checkin');
const dreamScheduler = require('./services/dreamScheduler');
const monitor = require('./services/monitor');
const goldPot = require('./services/GoldPot');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// 健康检查端点（给监控和系统cron用）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), pid: process.pid });
});

// Telegram Webhook 路由
app.post('/telegram/webhook', telegram.handleWebhook);

app.use('/api', require('./routes/chat'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/tasks', require('./routes/task'));
app.use('/api/footprints', require('./routes/footprint'));
app.use('/api', require('./routes/checkin'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api', require('./routes/dream'));

const PORT = process.env.PORT || 10000;
connectDB();

// 初始化 Telegram Bot
telegram.initBot();

// 初始化主动唤醒服务（等 bot 就绪后）
setTimeout(() => {
    const bot = telegram.getBot();
    if (bot) {
        initCheckin(bot);
    } else {
        console.log('[Checkin] Bot 未就绪，主动唤醒服务未启动');
    }
}, 5000);

// Dream 整理定时任务：每6小时全量整理 + 每小时记忆提取 + 每日MongoDB备份
dreamScheduler.start((message) => {
    console.log(`[Dream通知] ${message}`);
});

// 小金库：完成任务自动记账（功能开发2/次，debug 1.5/次，日常 1/次，按优先级浮动）
console.log(`[GoldPot] 按任务记账模式已启用，当前余额: ${goldPot.getBalance()}`);

// 监控服务
monitor.start((message) => {
    console.log(`[Monitor通知] ${message}`);
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log(`🚀 服务已启动，端口 ${PORT}`);
    // 写入健康标记文件（用绝对路径，供系统cron检测）
    const fs = require('fs');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, '.alive'), JSON.stringify({
        pid: process.pid,
        port: PORT,
        time: new Date().toISOString()
    }));
    console.log(`[Server] 健康标记已写入: ${path.join(dataDir, '.alive')} (PID: ${process.pid})`);
});

// 优雅退出
process.on('SIGTERM', () => {
    console.log('[Server] 收到SIGTERM，正在关闭...');
    dreamScheduler.stop();
    server.close(() => {
        console.log('[Server] 已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[Server] 收到SIGINT，正在关闭...');
    dreamScheduler.stop();
    server.close(() => {
        console.log('[Server] 已关闭');
        process.exit(0);
    });
});
