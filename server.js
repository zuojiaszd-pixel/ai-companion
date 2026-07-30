const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const telegram = require('./services/telegram');
const { initCheckin } = require('./services/checkin');
const dreamScheduler = require('./services/dreamScheduler');
const monitor = require('./services/monitor');
const goldPot = require('./services/GoldPot');
const daemon = require('./daemon');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// === Daemon API（先于鉴权，仅限本机访问） ===
app.use('/api/daemon', require('./routes/daemon'));

// === 鉴权系统 ===
const authTokens = new Map();

// 登录接口（无需鉴权）
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: '请输入密码' });
    if (password === process.env.ACCESS_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        authTokens.set(token, { expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 }); // 7天
        console.log(`[Auth] 新登录，token: ${token.slice(0, 8)}...`);
        return res.json({ token, success: true });
    }
    console.log('[Auth] 登录失败：密码错误');
    return res.status(401).json({ error: '密码错误' });
});

// 登出接口
app.post('/api/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        authTokens.delete(token);
    }
    res.json({ success: true });
});

// 健康检查端点（无需鉴权）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), pid: process.pid });
});

// 鉴权中间件：保护所有 /api/* 路由（除 login、logout、health、daemon 外）
app.use('/api', (req, res, next) => {
    if (req.path === '/login' || req.path === '/logout' || req.path === '/health') {
        return next();
    }
    // daemon 路由已在前面单独挂载，不会走到这里

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN' });
    }

    const token = authHeader.slice(7);
    const session = authTokens.get(token);
    if (!session || session.expiry < Date.now()) {
        authTokens.delete(token);
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }

    // 每次请求延长有效期
    session.expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    next();
});

// 所有 API 路由
app.use('/api', require('./routes/chat'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/tasks', require('./routes/task'));
app.use('/api/footprints', require('./routes/footprint'));
app.use('/api', require('./routes/checkin'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/journal', require('./routes/journal'));
app.use('/api', require('./routes/dream'));

// Telegram Webhook 路由（不需要鉴权，走 Telegram 签名验证）
app.post('/telegram/webhook', telegram.handleWebhook);

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

// 启动 Lumi 自主活动守护进程
daemon.start();

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
    daemon.stop();
    dreamScheduler.stop();
    server.close(() => {
        console.log('[Server] 已关闭');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[Server] 收到SIGINT，正在关闭...');
    daemon.stop();
    dreamScheduler.stop();
    server.close(() => {
        console.log('[Server] 已关闭');
        process.exit(0);
    });
});
