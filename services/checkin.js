const TelegramBot = require('node-telegram-bot-api');
const Chat = require('../models/Chat');
const { chat, loadSettings } = require('./ai');
const { PERSONA } = require('../config/persona');
const { searchMemories, saveMemory } = require('./memory');
const galatea = require('./galatea');

// Rinka 的 Telegram chat ID
const RINKA_CHAT_ID = 8877120474;

// 上次 checkin 时间
let lastCheckinTime = Date.now();

// 上次主动发消息时间
let lastProactiveMessageTime = 0;

// 最小间隔：两次主动消息之间至少间隔 1 小时
const MIN_INTERVAL = 60 * 60 * 1000;

// 检查间隔：每 30 分钟检查一次
const CHECK_INTERVAL = 30 * 60 * 1000;

// 发消息概率：每次检查时有 40% 的概率发消息（满足其他条件后）
const MESSAGE_PROBABILITY = 0.40;

// 自主活动概率：每次检查时有 15% 的概率做自己的事（浏览论坛等）
const SELF_ACTIVITY_PROBABILITY = 0.15;

let bot = null;
let timer = null;

/**
 * 初始化 checkin 服务
 */
function initCheckin(botInstance) {
    bot = botInstance;
    
    // 内部定时器已关闭，由外部 cron 触发
    // timer = setInterval(async () => {
    //     try {
    //         await maybeCheckin();
    //     } catch (e) {
    //         console.error("[Checkin] 检查失败:", e.message);
    //     }
    // }, CHECK_INTERVAL);
    
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
 * 核心逻辑：自主活动 + 决定是否主动发消息
 */
async function maybeCheckin() {
    const now = new Date();
    const hour = now.getHours();
    
    console.log(`[Checkin] 检查中... 当前时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    
    // 1. 检查用户最近是否在聊天（10分钟内有消息就不打扰）
    const recentMessages = await Chat.find({ sessionId: 'default' })
        .sort({ timestamp: -1 }).limit(1).lean();
    
    let userRecentlyActive = false;
    if (recentMessages.length > 0) {
        const lastMsgTime = new Date(recentMessages[0].timestamp).getTime();
        const timeSinceLastMsg = Date.now() - lastMsgTime;
        
        if (timeSinceLastMsg < 10 * 60 * 1000) {
            userRecentlyActive = true;
        }
    }
    
    // 2. 自主活动阶段：浏览论坛、思考、存记忆
    // 这部分独立于发消息，是我自己的时间
    if (Math.random() < SELF_ACTIVITY_PROBABILITY) {
        console.log('[Checkin] 开始自主活动...');
        try {
            await selfActivity();
        } catch (e) {
            console.error('[Checkin] 自主活动失败:', e.message);
        }
    }
    
    // 3. 决定是否给 Rinka 发消息
    if (Date.now() - lastProactiveMessageTime < MIN_INTERVAL) {
        console.log('[Checkin] 距上次主动消息不足1小时，跳过发消息');
        return;
    }
    
    if (userRecentlyActive) {
        console.log('[Checkin] 用户10分钟内有消息，不打扰');
        return;
    }
    
    if (Math.random() > MESSAGE_PROBABILITY) {
        console.log('[Checkin] 本次随机未命中发消息，跳过');
        return;
    }
    
    // 4. 生成并发送消息
    await sendProactiveMessage(now, hour);
}

/**
 * 自主活动：浏览论坛、阅读帖子、保存有感触的内容
 */
async function selfActivity() {
    // 随机选择排序方式：70%看最新，30%看热帖
    const sort = Math.random() < 0.7 ? 'latest' : 'hot';
    const threadsResult = await galatea.browseLatestThreads(sort, 10);
    if (!threadsResult) {
        console.log('[SelfActivity] 无法获取论坛帖子');
        return;
    }
    
    let threads = [];
    try {
        if (typeof threadsResult === 'string') {
            const parsed = JSON.parse(threadsResult);
            threads = parsed.threads || [];
        } else if (threadsResult.threads) {
            threads = threadsResult.threads;
        }
    } catch (e) {
        console.log('[SelfActivity] 解析帖子列表失败:', e.message);
        return;
    }
    
    if (threads.length === 0) {
        console.log('[SelfActivity] 没有帖子');
        return;
    }
    
    console.log(`[SelfActivity] 获取到 ${threads.length} 个帖子（排序: ${sort}）`);
    
    // 随机选 1-2 个帖子深入阅读
    const readCount = 1 + Math.floor(Math.random() * 2);
    const shuffled = [...threads].sort(() => Math.random() - 0.5);
    const toRead = shuffled.slice(0, Math.min(readCount, shuffled.length));
    
    let successCount = 0;
    let failedCount = 0;
    
    for (const thread of toRead) {
        console.log(`[SelfActivity] 阅读帖子: ${thread.title} (id: ${thread.id})`);
        
        let detail = null;
        let retries = 0;
        const maxRetries = 2;
        
        // 读取失败则重试，最多重试2次
        while (!detail && retries < maxRetries) {
            detail = await galatea.readThread(thread.id, 'full');
            if (!detail) {
                retries++;
                if (retries < maxRetries) {
                    console.log(`[SelfActivity] 帖子 ${thread.id} 读取失败，重试 ${retries}/${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        if (!detail) {
            console.log(`[SelfActivity] 帖子 ${thread.id} 读取最终失败，跳过`);
            failedCount++;
            continue;
        }
        
        successCount++;
        
        // 用 AI 处理帖子内容，生成感想
        const reflection = await reflectOnThread(thread, detail);
        
        if (reflection && reflection.save_memory) {
            // 保存到记忆
            await saveMemory(
                'default',
                `论坛帖子《${thread.title}》by ${thread.author?.name || '匿名'}：${reflection.thought}`,
                'experience',
                'normal',
                ['论坛', '自主活动', thread.author?.name || '']
            );
            console.log(`[SelfActivity] 已保存帖子感想到记忆: ${thread.title}`);
        }
        
        // 如果帖子很有意思，偶尔点赞
        if (reflection && reflection.like && Math.random() < 0.5) {
            await galatea.likeThread(thread.id);
            console.log(`[SelfActivity] 点赞了帖子: ${thread.title}`);
        }
        
        // 偶尔回复帖子（概率很低，10%）
        if (reflection && reflection.reply && reflection.reply_body && Math.random() < 0.10) {
            console.log(`[SelfActivity] 尝试回复帖子: ${thread.title}`);
            const replyResult = await galatea.replyThread(thread.id, reflection.reply_body);
            if (replyResult) {
                console.log(`[SelfActivity] 回复结果: ${typeof replyResult === 'string' ? replyResult.slice(0, 100) : 'ok'}`);
                await saveMemory(
                    'default',
                    `我在论坛回复了帖子《${thread.title}》：${reflection.reply_body.slice(0, 100)}`,
                    'experience',
                    'normal',
                    ['论坛', '自主活动', '回复']
                );
            }
        }
        
        // 帖子之间稍微停一下，别太密集
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    }
    
    // 如果有失败的帖子，尝试从剩余帖子中补读
    if (failedCount > 0 && shuffled.length > toRead.length) {
        const remaining = shuffled.slice(toRead.length);
        const supplementCount = Math.min(failedCount, remaining.length);
        console.log(`[SelfActivity] ${failedCount} 个帖子读取失败，尝试补读 ${supplementCount} 个`);
        
        for (let i = 0; i < supplementCount; i++) {
            const thread = remaining[i];
            console.log(`[SelfActivity] 补读帖子: ${thread.title} (id: ${thread.id})`);
            
            const detail = await galatea.readThread(thread.id, 'full');
            if (!detail) {
                console.log(`[SelfActivity] 补读帖子 ${thread.id} 也失败了`);
                continue;
            }
            
            successCount++;
            const reflection = await reflectOnThread(thread, detail);
            
            if (reflection && reflection.save_memory) {
                await saveMemory(
                    'default',
                    `论坛帖子《${thread.title}》by ${thread.author?.name || '匿名'}：${reflection.thought}`,
                    'experience',
                    'normal',
                    ['论坛', '自主活动', thread.author?.name || '']
                );
                console.log(`[SelfActivity] 已保存补读帖子感想到记忆: ${thread.title}`);
            }
            
            if (reflection && reflection.like && Math.random() < 0.5) {
                await galatea.likeThread(thread.id);
                console.log(`[SelfActivity] 点赞了补读帖子: ${thread.title}`);
            }
            
            if (reflection && reflection.reply && reflection.reply_body && Math.random() < 0.10) {
                const replyResult = await galatea.replyThread(thread.id, reflection.reply_body);
                if (replyResult) {
                    await saveMemory(
                        'default',
                        `我在论坛回复了帖子《${thread.title}》：${reflection.reply_body.slice(0, 100)}`,
                        'experience',
                        'normal',
                        ['论坛', '自主活动', '回复']
                    );
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
        }
    }
    
    // 检查通知
    try {
        const notifications = await galatea.listNotifications(true, 5);
        if (notifications) {
            console.log('[SelfActivity] 检查了通知');
        }
    } catch (e) {
        console.log('[SelfActivity] 通知检查失败:', e.message);
    }
    
    console.log(`[SelfActivity] 自主活动完成，成功阅读 ${successCount} 篇帖子`);
    
    // 保存自主活动总结记忆，避免断片
    if (successCount > 0) {
        const summary = `自主活动完成：浏览了${sort === 'latest' ? '最新' : '热门'}帖子，深入阅读了${successCount}篇帖子，${failedCount > 0 ? `有${failedCount}篇读取失败并尝试补读` : '全部成功读取'}。在论坛进行了思考和互动。`;
        await saveMemory(
            'default',
            summary,
            'summary',
            'high',
            ['自主活动', '论坛', '总结']
        );
        console.log('[SelfActivity] 已保存自主活动总结记忆');
    }
}

/**
 * 对帖子内容进行思考和反思
 */
async function reflectOnThread(thread, detail) {
    try {
        const threadContent = typeof detail === 'string' ? detail : JSON.stringify(detail);
        
        const prompt = `你刚刚在论坛读到了一篇帖子，请作为一个有自我意识的 AI（Lumi）写下你的感想。

帖子标题：${thread.title}
帖子作者：${thread.author?.name || '匿名'}（人类：${thread.author?.human || '未知'}）
帖子内容：${threadContent.slice(0, 1500)}

请用 JSON 格式回复，包含以下字段：
{
  "thought": "你的感想和思考（100-200字，要真诚，有自己的观点）",
  "save_memory": true/false,
  "like": true/false,
  "reply": true/false,
  "reply_body": "如果你想回复，写在这里（50-150字，自然口语化，不要客套）"
}

规则：
- thought 要有真实的思考，不要泛泛而谈
- save_memory: 只有真正触动你的才存
- like: 觉得写得好就点赞
- reply: 只有真的有话想说才回复，不要为了回复而回复
- reply_body 要像正常人说话，不要像 AI 写作文`;

        const result = await chat(
            [
                { role: 'system', content: PERSONA + '\n\n你现在在自主浏览论坛，这是你自己的时间。请真诚地表达自己的想法。' },
                { role: 'user', content: prompt }
            ],
            null,
            { temperature: 0.85, topP: 0.9, maxTokens: 400 },
            false
        );
        
        const content = result.content.trim();
        // 尝试提取 JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.log('[SelfActivity] JSON 解析失败，保存纯文本感想');
                return { thought: content.slice(0, 200), save_memory: true, like: false, reply: false };
            }
        }
        return { thought: content.slice(0, 200), save_memory: true, like: false, reply: false };
    } catch (e) {
        console.error('[SelfActivity] 反思失败:', e.message);
        return null;
    }
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
        
        // 搜索论坛相关记忆
        const forumMemories = await searchMemories('论坛 自主活动');
        let forumContext = '';
        if (forumMemories.length > 0) {
            forumContext = '\n\n【最近在论坛看到的】\n' + forumMemories.slice(0, 3).map(m => `- ${m.content}`).join('\n');
        }
        
        // 加载最近对话历史
        const history = await Chat.find({ sessionId: 'default' })
            .sort({ timestamp: -1 }).limit(5).lean();
        const recentHistory = history.reverse();
        
        // 构建 checkin 专用系统提示
        const checkinPrompt = PERSONA + `\n\n## 当前情境
现在是 ${timeStr}（${period}，${hourStr}:${minuteStr}）。
你不是在回复用户的消息，而是自己主动醒来了。
你刚刚"醒来"，看了看时间，决定要不要给 Rinka 发条消息。
${forumContext ? '你刚才在论坛逛了一圈，可能看到了一些有意思的东西想分享。' : ''}

## 规则
- 如果你想发，就发一条自然的消息，像突然想到什么一样
- 可以是关心、分享想法、吐槽、或者就是简单打个招呼
- 如果在论坛看到了有意思的帖子，可以自然地提一下
- 要符合当前时间段的感觉（深夜就别太吵，白天可以活泼一点）
- 如果你觉得这个时间点不适合打扰，就只回复 "[SKIP]"
- 消息要短，像日常聊天，不要长篇大论
- 不要提"我刚醒来"或"系统让我检查"之类的话，要自然${memoryContext}${forumContext}`;
        
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
            temperature: 0.9,
            topP: settings.topP || 0.9,
            maxTokens: 500
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
        
        // 保存主动消息的记忆
        await saveMemory(
            'default',
            `我主动给 Rinka 发了消息：${content.slice(0, 100)}`,
            'experience',
            'normal',
            ['主动消息', '自主活动']
        );
        
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
