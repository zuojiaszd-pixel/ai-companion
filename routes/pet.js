// 小萤火桌宠专用路由：主动搭话队列
// Rinka电脑上的桌宠轮询 /pet/poll 拿走我的主动消息；我这边通过本地文件或 enqueue 塞消息
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const QUEUE_FILE = path.join(__dirname, '..', 'config', 'pet_queue.json');

function readQueue() {
    try {
        const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
        const arr = JSON.parse(data);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function writeQueue(arr) {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(arr, null, 2), 'utf-8');
}

// 桌宠轮询：拿走所有待推送消息并清空队列
router.get('/poll', (req, res) => {
    const msgs = readQueue();
    if (msgs.length > 0) writeQueue([]);
    res.json({ messages: msgs, serverTime: new Date().toISOString() });
});

// 塞一条主动消息（供本地脚本/daemon调用；外网走token鉴权，风险可控）
router.post('/enqueue', (req, res) => {
    const { text, mood } = req.body || {};
    if (!text || typeof text !== 'string' || text.length > 200) {
        return res.status(400).json({ error: 'text 必填且不超过200字' });
    }
    const queue = readQueue();
    queue.push({ text: text.trim(), mood: mood || null, at: new Date().toISOString() });
    // 队列上限50条，防止堆积
    writeQueue(queue.slice(-50));
    res.json({ success: true, queueLen: Math.min(queue.length, 50) });
});

module.exports = router;
