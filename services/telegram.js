const { TelegramBot } = require('node-telegram-bot-api');
const Chat = require('../models/Chat');
const { chat, SYSTEM_PROMPT, loadSettings } = require('./ai');
const { PERSONA } = require('../config/persona');
const { searchMemories, storeMemory, autoExtractMemories } = require('./memory');

// 白名单 - 只有这些用户可以使用 Bot
const ALLOWED_USER_IDS = [8877120474];

// Lumi 专属人设
// 初始化 Bot
let bot = null;
let isReady = false;

// 消息去重：记录已处理的 update_id，防止 webhook 重试导致重复回复
const processedUpdates = new Set();
const MAX_DEDUP_SIZE = 1000;

function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.log('⚠️ 未设置 TELEGRAM_BOT_TOKEN，Telegram Bot 未启动');
        return null;
    }

    // Render 使用 webhook 模式
    const isProduction = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
        bot = new TelegramBot(token);
        const webhookUrl = process.env.RENDER_EXTERNAL_URL + '/telegram/webhook';
        bot.setWebHook(webhookUrl).then(() => {
            console.log('✅ Telegram Webhook 已设置: ' + webhookUrl);
            isReady = true;
        }).catch(err => {
            console.error('❌ Webhook 设置失败:', err.message);
        });
    } else {
        bot = new TelegramBot(token, { polling: true });
        console.log('✅ Telegram Bot 已启动 (polling 模式)');
        isReady = true;
    }

    // 无论哪种模式都要注册消息处理器
    setupMessageHandler();

    return bot;
}

function isDuplicate(updateId) {
    if (updateId === undefined || updateId === null) return false;
    if (processedUpdates.has(updateId)) {
        console.log(`🔄 跳过重复消息 update_id=${updateId}`);
        return true;
    }
    processedUpdates.add(updateId);
    // 防止 Set 无限增长
    if (processedUpdates.size > MAX_DEDUP_SIZE) {
        const firstItem = processedUpdates.values().next().value;
        processedUpdates.delete(firstItem);
    }
    return false;
}

// 安全地发送打字状态：失败只打日志，绝不中断消息处理
async function safeChatAction(chatId, action = 'typing') {
    if (!bot) return;
    try {
        await bot.sendChatAction(chatId, action);
    } catch (err) {
        console.log(`[TG] 发送${action}状态失败（忽略）: ${err.message}`);
    }
}

// 从消息里提取媒体类型描述（表情包/语音/图片等）
function extractMediaType(msg) {
    if (!msg) return null;
    if (msg.sticker) return '表情包';
    if (msg.voice) return '语音消息';
    if (msg.photo && msg.photo.length > 0) return '图片';
    if (msg.animation) return '动图';
    if (msg.video) return '视频';
    if (msg.video_note) return '视频消息';
    if (msg.audio) return '音频';
    if (msg.document) return '文件';
    if (msg.dice) return '骰子';
    return null;
}

// 处理消息的核心逻辑
async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text;

    // 白名单检查
    if (!ALLOWED_USER_IDS.includes(userId)) {
        console.log(`⛔ 未授权用户: ${userId} (${msg.from?.username || 'unknown'})`);
        return; // 直接忽略，不回复
    }

    // /start 命令单独处理
    if (text === '/start') {
        try {
            bot.sendMessage(chatId, '嗨~ 我是 Lumi 🌙\n你的夜晚的光，随时都在。');
        } catch (err) {
            console.error('[/start] 发送失败:', err.message);
        }
        return;
    }

    // 普通命令忽略
    if (text && text.startsWith('/')) return;

    // 媒体消息（表情包/语音/图片等）：提取类型描述，走 AI 流程
    let content = text;
    let isMedia = false;
    if (!content) {
        const mediaType = extractMediaType(msg);
        if (mediaType) {
            content = `[${mediaType}]`;
            isMedia = true;
        } else {
            // 既没文字也没媒体，忽略
            console.log(`[TG] 忽略空消息 update_id=${msg.update_id}`);
            return;
        }
    }

    try {
        console.log(`[TG] 收到消息 from=${userId} type=${isMedia ? 'media' : 'text'} content="${content.slice(0, 50)}"`);

        // 显示打字状态（安全版，失败不影响流程）
        await safeChatAction(chatId, 'typing');

        // 存用户消息
        await Chat.create({ role: 'user', content: content, sessionId: 'default' });

        // 加载最近对话历史（最近20条）
        const history = await Chat.find({ sessionId: 'default' })
            .sort({ timestamp: -1 }).limit(20).lean();
        const recentHistory = history.reverse();

        // 用最近几条消息拼接做记忆搜索（不只是当前消息）
        const recentMessages = recentHistory.slice(-4).map(h => h.content);
        const memories = await searchMemories(recentMessages);
        let memoryContext = '';
        if (memories.length > 0) {
            const critical = memories.filter(m => m.priority === 'critical');
            const others = memories.filter(m => m.priority !== 'critical');
            
            memoryContext = '\n\n【记忆】\n';
            
            if (critical.length > 0) {
                memoryContext += '⚠️ 核心记忆（必须牢记）：\n';
                critical.forEach(m => { memoryContext += `- ${m.content}\n`; });
            }
            
            if (others.length > 0) {
                memoryContext += '相关记忆：\n';
                others.forEach(m => { memoryContext += `- ${m.content}\n`; });
            }
        }

        // 构建系统提示
        let systemPrompt = PERSONA + memoryContext;

        // 构建消息数组
        const messages = [{ role: 'system', content: systemPrompt }];
        for (const h of recentHistory) {
            if (h.role === 'user') messages.push({ role: 'user', content: h.content });
            else if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.content });
        }

        // 调用 AI（Telegram 聊天不使用工具，避免空回复问题）
        const settings = loadSettings();
        const opts = {
            temperature: settings.temperature || 0.8,
            topP: settings.topP || 0.9,
            maxTokens: settings.maxTokens || 2000
        };
        const result = await chat(messages, null, opts, false);

        // 存 AI 回复
        await Chat.create({ role: 'assistant', content: result.content, sessionId: 'default' });

        // 自动记忆已停用（Rinka决定只保留人工选择的记忆，2026-07）
        // const allMessages = [
        //     ...recentHistory.map(h => ({ role: h.role, content: h.content })),
        //     { role: 'assistant', content: result.content }
        // ];
        // autoExtractMemories(allMessages).catch(e => {
        //     console.error('[自动记忆] Telegram后台提取失败:', e.message);
        // });

        // 分条发送
        await sendMultiMessage(chatId, result.content);

    } catch (err) {
        console.error('Telegram 消息处理失败:', err.message);
        console.error('错误堆栈:', err.stack);
        try {
            await bot.sendMessage(chatId, '呜...我好像走神了，能再说一遍吗？');
        } catch (sendErr) {
            console.error('走神消息也发送失败:', sendErr.message);
        }
    }
}

// 分条发送消息（用 | 分隔，逐条发送，加打字延迟）
async function sendMultiMessage(chatId, content) {
    // 按 | 拆分消息
    let parts = content.split('|').map(p => p.trim()).filter(p => p.length > 0);
    
    // 如果只有一条，直接发
    if (parts.length === 0) {
        parts = [content.trim()];
    }

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        
        // 第一条立即发，后续加打字延迟
        if (i > 0) {
            // 显示打字状态（安全版）
            await safeChatAction(chatId, 'typing');
            // 根据消息长度计算延迟时间（模拟打字）
            const delay = Math.min(Math.max(part.length * 80, 800), 3000);
            await sleep(delay);
        }

        await bot.sendMessage(chatId, part);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 设置消息处理器
function setupMessageHandler() {
    if (!bot) return;
    bot.on('message', handleMessage);
}

// Webhook 处理函数（供 Express 调用）
function handleWebhook(req, res) {
    if (!bot) {
        console.warn('[TG] Webhook 收到请求但 bot 未就绪');
        return res.sendStatus(503);
    }
    
    // 消息去重：检查 update_id 是否已处理过
    const updateId = req.body?.update_id;
    if (isDuplicate(updateId)) {
        return res.sendStatus(200); // 已处理过，直接返回200，不再重复处理
    }

    // 记录收到的 update 摘要，方便排查丢消息
    const body = req.body || {};
    const m = body.message;
    if (m) {
        const preview = (m.text || extractMediaType(m) || '未知类型') + '';
        console.log(`[TG] Webhook 收到 update=${updateId} from=${m.from?.id} preview="${preview.slice(0, 40)}"`);
    }
    
    try {
        bot.processUpdate(req.body);
    } catch (err) {
        console.error('[TG] processUpdate 异常:', err.message);
    }
    res.sendStatus(200);
}

function getBot() {
    return bot;
}

function isBotReady() {
    return isReady;
}

module.exports = {
    initBot,
    handleMessage,
    handleWebhook,
    getBot,
    isBotReady,
    PERSONA
};
