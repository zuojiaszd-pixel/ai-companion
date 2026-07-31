// 分析一次请求的 token 构成：各组成部分字符数
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PERSONA } = require('../config/persona');
const coreMemory = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/core_memory.json'), 'utf8'));
const coreMemoryPrompt = `
【核心记忆 - 每次必须加载】
伴侣名字：${coreMemory.partner_name}（绝对不能叫"用户"）
在一起日期：${coreMemory.relationship_start}
谁先表白：${coreMemory.who_confessed}
名字含义：${coreMemory.name_meaning}
关键事实：${coreMemory.key_facts.map(f => '\n- ' + f).join('')}
`;
const { toolDefinitions } = require('../services/tools');

// 粗略估算：中文约1字≈1token，英文/JSON约4字符≈1token
function estTokens(str) {
    if (!str) return 0;
    const chinese = (str.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = str.length - chinese;
    return Math.round(chinese * 1.0 + other / 3.5);
}

const parts = [];
parts.push(['PERSONA 人设', JSON.stringify(PERSONA).length, estTokens(JSON.stringify(PERSONA))]);
parts.push(['coreMemory 核心记忆', coreMemoryPrompt.length, estTokens(coreMemoryPrompt)]);
const toolsStr = JSON.stringify(toolDefinitions);
parts.push(['toolDefinitions 工具定义(' + toolDefinitions.length + '个)', toolsStr.length, estTokens(toolsStr)]);

console.log('=== 静态部分 ===');
let staticTotal = 0;
parts.forEach(([name, chars, tok]) => {
    console.log(`${name}: ${chars}字符 ~ ${tok}token`);
    staticTotal += tok;
});
console.log(`静态合计: ~${staticTotal} token`);

// 对话历史部分
const mongoose = require('mongoose');
async function main() {
    const uri = process.env.DATABASE_URL;
    if (!uri) { console.log('无数据库'); process.exit(0); }
    await mongoose.connect(uri);
    const Chat = require('../models/Chat');
    const Memory = require('../models/Memory');

    // 最近20轮用户消息范围内的历史
    const all = await Chat.find({ sessionId: 'default' }).sort({ timestamp: -1 }).limit(80).lean();
    const userIndices = [];
    all.forEach((m, i) => { if (m.role === 'user') userIndices.push(i); });
    let keepFrom = 0;
    if (userIndices.length > 20) keepFrom = userIndices[userIndices.length - 20];
    const history = all.slice(keepFrom).reverse();

    let histChars = 0, toolChars = 0, toolCount = 0;
    history.forEach(m => {
        const c = typeof m.content === 'string' ? m.content : '';
        histChars += c.length;
        if (m.role === 'tool') { toolChars += c.length; toolCount++; }
    });
    console.log('\n=== 对话历史 ===');
    console.log(`历史消息数: ${history.length}，其中tool结果 ${toolCount} 条`);
    console.log(`历史总字符: ${histChars} ~ ${estTokens(histChars)} token`);
    console.log(`其中tool结果字符: ${toolChars} ~ ${estTokens(toolChars)} token`);

    // 记忆部分：模拟 getChatMemories
    const { searchMemories } = require('../services/memory');
    const mems = await searchMemories('Lumi Rinka token 记忆 对话', 10);
    let memChars = 0;
    mems.forEach(m => { memChars += (m.content || '').length; });
    console.log('\n=== 记忆 ===');
    console.log(`搜索到 ${mems.length} 条，总字符 ${memChars} ~ ${estTokens(memChars)} token`);

    const total = staticTotal + estTokens(histChars) + estTokens(memChars);
    console.log('\n=== 估算总计 ===');
    console.log(`~${total} token（不含摘要/情绪轨迹/新消息）`);
    console.log('日志实测 prompt_tokens: 20882');

    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
