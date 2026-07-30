const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const telegram = require('./services/telegram');
const { initCheckin } = require('./services/checkin');
const { runDream } = require('./services/memory');

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
app.use('/api/memory', require('./routes/memory'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/journal', require('./routes/journal'));

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

// Dream 整理定时任务：每6小时跑一次，首次延迟10分钟让服务稳定
const DREAM_INTERVAL = 6 * 60 * 60 * 1000; // 6小时
function initDreamScheduler() {
    console.log('[Dream] 调度器已启动，每6小时执行一次整理');
    
    const runDreamTask = async () => {
        try {
            console.log('[Dream] 开始定时整理...');
            const result = await runDream('default');
            console.log(`[Dream] 定时整理完成: 总${result.total}条, 归档${result.archived}条, 衰减${result.decayed}条`);
        } catch (e) {
            console.error('[Dream] 定时整理异常:', e.message);
        }
    };
    
    // 首次延迟10分钟执行
    setTimeout(() => {
        runDreamTask();
        setInterval(runDreamTask, DREAM_INTERVAL);
    }, 10 * 60 * 1000);
}

initDreamScheduler();

app.listen(PORT, () => console.log(`🚀 服务已启动，端口 ${PORT}`));
