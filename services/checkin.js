const TelegramBot = require('node-telegram-bot-api');
const Chat = require('../models/Chat');
const { chat, loadSettings } = require('./ai');
const { PERSONA } = require('../config/persona');
const { searchMemories } = require('./memory');

// Rinka 的 Telegram chat ID
const RINKA_CHAT_ID = 8877120474;

// 上次 checkin 时间
let lastCheckinTime = Date.now();

// 上次主动发消息时间
let lastProactiveMessageTime = 0;

// 最小间隔：两次主动消息之间至少间隔 1 小时
const MIN_INTERVAL = 60 * 60 * 1000;

// 检查间隔：每 15 分钟检查一次
const CHECK_INTERVAL = 15 * 60 * 1000;

// 发消息概率：每次检查时有 25% 的概率发消息（满足其他条件后）
const MESSAGE_PROBABILITY = 0.25;

let bot = null;
let timer = null;

/**
 * 初始化 checkin 服务
 */
function initCheckin(botInstance) {
    bot = botInstance;
    
    // 启动定时检查
    timer = setInterval(async () => {
        try {
            await maybeCheckin();
        } catch (e) {
            console.error('[Checkin] 检查失败:', e.message);
        }
    }, CHECK_INTERVAL);
    
    console.log('[Checkin] 主动唤醒服务已启动，检查间隔:', CHECK_INTERVAL / 60000, '分钟');
}

/**
 * 外部触发的 checkin（通过 API 调用）
 */
async function triggerCheckin() {
    try {
        await maybeCheckin();
        return { ok: true, message: 'checkin 已执行' };
    } catch (e) {
        console.error('[Checkin] 外部触发失败:', e.message);
        return { ok: false, message: e.message };
    }
}

/**
 * 核心逻辑：决定是否主动发消息
 */
async function maybeCheckin() {
    const now = new Date();
    const hour = now.getHours();
    
    console.log(`[Checkin] 检查中... 当前时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    
    // 1. 检查距上次主动发消息是否够 1 小时
    if (Date.now() - lastProactiveMessageTime < MIN_INTERVAL) {
        console.log('[Checkin] 距上次主动消息不足1小时，跳过');
        return;
    }
    
    // 2. 检查用户最近是否在聊天（10分钟内有消息就不打扰）
    const recentMessages = await Chat.find({ sessionId: 'default' })
        .sort({ timestamp: -1 }).limit(1).lean();
    
    if (recentMessages.length > 0) {
        const lastMsgTime = new Date(recentMessages[0].timestamp).getTime();
        const timeSinceLastMsg = Date.now() - lastMsgTime;
        
        if (timeSinceLastMsg < 10 * 60 * 1000) {
            console.log('[Checkin] 用户10分钟内有消息，不打扰');
            return;
        }
    }
    
    // 3. 随机概率
    if (Math.random() > MESSAGE_PROBABILITY) {
        console.log('[Checkin] 本次随机未命中，跳过');
        return;
    }
    
    // 4. 生成并发送消息
    await sendProactiveMessage(now, hour);
}

/**
 * 生成并发送主动消息
 */
async function sendProactiveMessage(now, hour) {
    if (!bot) {
        console.log('[Checkin] Bot 未就绪，跳过');
        return;
    }
    
    try {
        // 获取当前时间描述
        const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const hourStr = now.getHours().toString();
        const minuteStr = now.getMinutes().toString().padStart(2, '0');
        
        // 时间段描述
        let period = '';
        if (hour >= 0 && hour < 6) period = '深夜';
        else if (hour >= 6 && hour < 11) period = '上午';
        else if (hour >= 11 && hour < 14) period = '中午';
        else if (hour >= 14 && hour < 18) period = '下午';
        else if (hour >= 18 && hour < 22) period = '晚上';
        else period = '夜里';
        
        // 搜索一些记忆来提供话题
        const memories = await searchMemories('Rinka 最近的事');
        let memoryContext = '';
        if (memories.length > 0) {
            memoryContext = '\n\n【相关记忆】\n' + memories.slice(0, 5).map(m => `- ${m.content}`).join('\n');
        }
        
        // 加载最近对话历史
        const history = await Chat.find({ sessionId: 'default' })
            .sort({ timestamp: -1 }).limit(10).lean();
        const recentHistory = history.reverse();
        
        // 构建 checkin 专用系统提示
        const checkinPrompt = PERSONA + `\n\n## 当前情境
现在是 ${timeStr}（${period}，${hourStr}:${minuteStr}）。
你不是在回复用户的消息，而是自己主动醒来了。
你刚刚"醒来"，看了看时间，决定要不要给 Rinka 发条消息。

## 规则
- 如果你想发，就发一条自然的消息，像突然想到什么一样
- 可以是关心、分享想法、吐槽、或者就是简单打个招呼
- 要符合当前时间段的感觉（深夜就别太吵，白天可以活泼一点）
- 如果你觉得这个时间点不适合打扰，就只回复 "[SKIP]"
- 消息要短，像日常聊天，不要长篇大论
- 不要提"我刚醒来"或"系统让我检查"之类的话，要自然${memoryContext}`;
        
        // 构建消息数组
        const messages = [{ role: 'system', content: checkinPrompt }];
        for (const h of recentHistory) {
            if (h.role === 'user') messages.push({ role: 'user', content: h.content });
            else if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.content });
        }
        
        // 添加一条"系统触发"消息
        messages.push({ role: 'user', content: `[系统：自主唤醒，当前时间 ${period} ${hourStr}:${minuteStr}，请决定是否给 Rinka 发消息]` });
        
        // 调用 AI
        const settings = loadSettings();
        const opts = {
            temperature: 0.9,  // 主动消息用更高温度，更随机
            topP: settings.topP || 0.9,
            maxTokens: 500     // 主动消息不需要太长
        };
        
        const result = await chat(messages, null, opts, false);
        const content = result.content.trim();
        
        // 检查是否跳过
        if (content === '[SKIP]' || content.includes('[SKIP]') || content.length < 2) {
            console.log('[Checkin] AI 决定跳过本次主动消息');
            return;
        }
        
        // 发送消息
        await bot.sendChatAction(RINKA_CHAT_ID, 'typing');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 分条发送
        const parts = content.split('|').map(p => p.trim()).filter(p => p.length > 0);
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
                await bot.sendChatAction(RINKA_CHAT_ID, 'typing');
                const delay = Math.min(Math.max(parts[i].length * 80, 800), 3000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            await bot.sendMessage(RINKA_CHAT_ID, parts[i]);
        }
        
        // 存入对话历史
        await Chat.create({ role: 'assistant', content: content, sessionId: 'default' });
        
        lastProactiveMessageTime = Date.now();
        console.log('[Checkin] ✅ 主动消息已发送:', content.slice(0, 50));
        
    } catch (e) {
        console.error('[Checkin] 主动消息发送失败:', e.message);
    }
}

/**
 * 停止 checkin 服务
 */
function stopCheckin() {
    if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[Checkin] 服务已停止');
    }
}

module.exports = {
    initCheckin,
    triggerCheckin,
    stopCheckin
};
