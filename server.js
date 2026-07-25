const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const telegram = require('./services/telegram');
const { initCheckin } = require('./services/checkin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Telegram Webhook 路由
app.post('/telegram/webhook', telegram.handleWebhook);

app.use('/api', require('./routes/chat'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/tasks', require('./routes/task'));
app.use('/api/footprints', require('./routes/footprint'));
app.use('/api', require('./routes/checkin'));

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

app.listen(PORT, () => console.log(`🚀 服务已启动，端口 ${PORT}`));
