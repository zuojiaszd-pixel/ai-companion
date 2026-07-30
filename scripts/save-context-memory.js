/**
 * 对话记忆保存脚本
 * 用法：node scripts/save-context-memory.js '<JSON>'
 * 
 * JSON 格式：
 * {
 *   "content": "记忆内容",
 *   "type": "core|tech|state",
 *   "priority": "critical|high|normal|low",
 *   "mood": "情绪标签（如 happy/sad/angry/etc）",
 *   "moodIntensity": 0-10,
 *   "tags": ["标签1", "标签2"],
 *   "ttl": 90          // 仅对 tech 类型有效
 * }
 */

const http = require('http');

const args = process.argv.slice(2);
if (!args.length) {
    console.error('用法: node save-context-memory.js \'<JSON>\'');
    process.exit(1);
}

let data;
try {
    data = JSON.parse(args[0]);
} catch (e) {
    console.error('JSON 解析失败:', e.message);
    process.exit(1);
}

if (!data.content) {
    console.error('缺少 content');
    process.exit(1);
}

const payload = JSON.stringify({
    content: data.content,
    type: data.type || 'core',
    priority: data.priority || 'normal',
    tags: data.tags || [],
    sessionId: data.sessionId || 'default',
    mood: data.mood || null,
    moodIntensity: data.moodIntensity != null ? data.moodIntensity : null,
    ttl: data.ttl || null
});

// 先登录获取 token
const loginReq = http.request({
    hostname: 'localhost',
    port: 10000,
    path: '/api/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
}, (loginRes) => {
    let body = '';
    loginRes.on('data', chunk => body += chunk);
    loginRes.on('end', () => {
        const { token } = JSON.parse(body);
        if (!token) {
            console.error('登录失败');
            process.exit(1);
        }

        // 用 token 保存记忆
        const saveReq = http.request({
            hostname: 'localhost',
            port: 10000,
            path: '/api/memory',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }, (saveRes) => {
            let body2 = '';
            saveRes.on('data', chunk => body2 += chunk);
            saveRes.on('end', () => {
                const result = JSON.parse(body2);
                if (result.success) {
                    console.log('✅ 记忆已保存:', result.data._id);
                } else {
                    console.error('❌ 保存失败:', result.error);
                }
            });
        });

        saveReq.write(payload);
        saveReq.end();
    });
});

loginReq.write(JSON.stringify({ password: process.env.ACCESS_PASSWORD || 'Rinka330' }));
loginReq.end();
