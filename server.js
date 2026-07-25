const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const telegram = require('./services/telegram');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Telegram Webhook 路由
app.post('/telegram/webhook', telegram.handleWebhook);

app.use('/api', require('./routes/chat'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/tasks', require('./routes/task'));

const PORT = process.env.PORT || 10000;
connectDB();

// 初始化 Telegram Bot
telegram.initBot();

app.listen(PORT, () => console.log(`🚀 服务已启动，端口 ${PORT}`));
