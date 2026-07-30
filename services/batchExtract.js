/**
 * 批量记忆提取服务
 * 定期扫描聊天记录，自动提取长期记忆
 */
const Chat = require('../models/Chat');
const { autoExtractMemories } = require('./memory');
const fs = require('fs');
const path = require('path');

// 检查点文件：记录上次提取到哪条消息
const CHECKPOINT_FILE = path.join(__dirname, '..', 'data', 'batch_extract_checkpoint.json');

function loadCheckpoint() {
    try {
        if (fs.existsSync(CHECKPOINT_FILE)) {
            return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('[BatchExtract] 读取检查点失败:', e.message);
    }
    return { lastProcessedId: null, lastProcessedAt: null };
}

function saveCheckpoint(checkpoint) {
    try {
        const dir = path.dirname(CHECKPOINT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), 'utf-8');
    } catch (e) {
        console.error('[BatchExtract] 保存检查点失败:', e.message);
    }
}

/**
 * 批量提取记忆
 * @param {number} batchSize - 一次处理的消息对数（用户+助手算一对）
 * @param {string} sessionId - 会话ID
 */
async function batchExtractMemories(batchSize = 10, sessionId = 'default') {
    try {
        const checkpoint = loadCheckpoint();
        
        // 获取上次处理后的新消息
        let query = { sessionId };
        if (checkpoint.lastProcessedId) {
            query._id = { $gt: checkpoint.lastProcessedId };
        }
        
        const newMessages = await Chat.find(query)
            .sort({ _id: 1 })
            .limit(batchSize * 2) // 2倍buffer，确保能凑够配对
            .lean();
        
        if (newMessages.length === 0) {
            return { processed: 0, message: '无新消息' };
        }
        
        // 只取最近的 user+assistant 配对（autoExtractMemories需要对话结构）
        // 按顺序收集 user/assistant 消息
        const pairedMessages = [];
        for (const msg of newMessages) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                pairedMessages.push({ role: msg.role, content: msg.content });
            }
        }
        
        // 至少需要一轮完整的对话（user+assistant）
        if (pairedMessages.length < 2) {
            // 保存检查点但标记为已处理
            const lastMsg = newMessages[newMessages.length - 1];
            saveCheckpoint({ lastProcessedId: lastMsg._id, lastProcessedAt: new Date().toISOString() });
            return { processed: 0, message: '消息不足一轮对话' };
        }
        
        // 调用自动提取
        await autoExtractMemories(pairedMessages);
        
        // 更新检查点
        const lastMsg = newMessages[newMessages.length - 1];
        saveCheckpoint({ lastProcessedId: lastMsg._id, lastProcessedAt: new Date().toISOString() });
        
        console.log(`[BatchExtract] 扫描了${newMessages.length}条消息，提取记忆完成`);
        return { processed: newMessages.length, message: 'ok' };
    } catch (e) {
        console.error('[BatchExtract] 失败:', e.message);
        return { processed: 0, error: e.message };
    }
}

/**
 * 启动定时扫描
 * @param {number} intervalMinutes - 扫描间隔（分钟）
 */
function startBatchExtract(intervalMinutes = 30) {
    console.log(`[BatchExtract] 启动定时扫描，间隔${intervalMinutes}分钟`);
    
    // 启动时立即跑一次
    setTimeout(() => {
        batchExtractMemories(20).catch(e => {
            console.error('[BatchExtract] 首次扫描失败:', e.message);
        });
    }, 10000); // 等服务器启动完再跑
    
    // 定时扫描
    setInterval(() => {
        batchExtractMemories(20).catch(e => {
            console.error('[BatchExtract] 定时扫描失败:', e.message);
        });
    }, intervalMinutes * 60 * 1000);
}

module.exports = { batchExtractMemories, startBatchExtract };
