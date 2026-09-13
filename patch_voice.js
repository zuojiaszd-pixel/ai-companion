const fs = require('fs');
const p = '/home/ubuntu/ai-companion/frontend/index.html';
let s = fs.readFileSync(p, 'utf8');
let n = 0;

// 1. 历史加载时把 voice 字段传给 addMsg（核心bug）
const old1 = "data.messages.forEach(m => addMsg(m.role, m.content, false));";
const new1 = "data.messages.forEach(m => addMsg(m.role, m.content, false, m.voice));";
if (s.includes(old1)) { s = s.replace(old1, new1); n++; console.log('OK 1: 历史加载传voice'); }
else console.log('SKIP 1: 没找到目标行');

// 2. 消息文本里的🔊emoji清掉（语音条自己有图标，别挤在一起）
const old2 = "const safe = (text || '')";
const new2 = "const safe = ((text || '').replace(/\\uD83D\\uDD0A/g, ''))";
if (s.includes(old2)) { s = s.replace(old2, new2); n++; console.log('OK 2: 清理喇叭emoji'); }
else console.log('SKIP 2: 没找到目标行');

// 3. renderVoiceBubble 兼容数据库里的字符串格式
const old3 = 'function renderVoiceBubble(v) {';
const new3 = "function renderVoiceBubble(v) {\n  if (typeof v === 'string') v = { file: String(v).split('/').pop() };";
if (s.includes(old3) && !s.includes("typeof v === 'string'")) { s = s.replace(old3, new3); n++; console.log('OK 3: 兼容字符串voice'); }
else console.log('SKIP 3: 已兼容或没找到');

fs.writeFileSync(p, s);
console.log('=== 补丁完成，共改', n, '处 ===');
