/**
 * 补充体检：常驻卡清单 + 相关记忆真实检索结果 + 重复检测（只读）
 * 用法：node scripts/qa_token_audit2.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

function estMem(text) {
    if (!text) return 0;
    text = String(text);
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    return Math.round(cjk + (text.length - cjk) * 0.5);
}
function fmt(m) {
    let line = `[${m.kind || 'core'}/${m.priority || 'normal'}] ${m.content || ''}`;
    if (m.title) line += `（${m.title}）`;
    if (m.lumiThought) line += ` Lumi想法：${m.lumiThought}`;
    const emotions = (m.emotions || []).slice(-3).map(e => `${e.emotion}${e.intensity != null ? `(${e.intensity}/10)` : ''}`).join('、');
    if (emotions) line += ` 情绪：${emotions}`;
    const timeline = (m.timeline || []).slice(-3).map(t => `${t.date} ${t.event}`).join('；');
    if (timeline) line += ` 时间线：${timeline}`;
    return line;
}

(async () => {
    await mongoose.connect(process.env.DATABASE_URL);
    const col = mongoose.connection.db.collection('memories');
    const sessionId = 'default';

    console.log('========== A. 当前霸着常驻位的 9 张卡（按 updatedAt 倒序）==========');
    const resident = await col.find({
        sessionId, kind: 'core', priority: 'critical',
        supersededBy: null, contradicted: false, archived: false
    }).project({ embedding: 0 }).sort({ updatedAt: -1 }).limit(10).toArray();
    let acc = 0;
    resident.forEach((r, i) => {
        const line = fmt(r);
        const t = estMem(line + '\n');
        const inCtx = acc + t <= 2500;
        if (inCtx) acc += t;
        const d = r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : '?';
        console.log(`${String(i + 1).padStart(2)}. ${inCtx ? '✅' : '❌'} [${String(t).padStart(4)}t] ${d} ${String(r.title || r.content).slice(0, 42)}`);
    });
    console.log('合计进上下文:', acc, 'token');

    console.log('\n========== B. 这些卡里有没有在写"诊断报告"腔调 ==========');
    const diagWords = ['查证结论', '病灶', '根因', '契约', '缺失', '机制', '判定', '架构', '边界', '验收'];
    let diagHit = 0;
    for (const r of resident) {
        const all = (r.content || '') + (r.title || '') + (r.lumiThought || '');
        const hit = diagWords.filter(w => all.includes(w));
        if (hit.length) { diagHit++; console.log(`· ${String(r.title || r.content).slice(0, 30)} → 命中 [${hit.join(',')}]`); }
    }
    console.log(`→ 10 张里有 ${diagHit} 张带诊断腔词汇`);

    console.log('\n========== C. 与 core_memory.json 的重复 ==========');
    const coreMemory = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/core_memory.json'), 'utf8'));
    for (const r of resident) {
        const c = String(r.content || '');
        for (const f of coreMemory.key_facts) {
            const key = f.slice(0, 12);
            if (c.includes(key) || (r.title || '').includes(key)) {
                console.log(`· 常驻卡「${String(r.title || c).slice(0, 28)}」重复了 core_memory 的：「${f.slice(0, 30)}」`);
            }
        }
    }

    console.log('\n========== D. 相关记忆检索：不受预算限制时本来能返回什么 ==========');
    const { recallMemories } = require('../services/memory');
    const chatCol = mongoose.connection.db.collection('chats');
    const lastMsgs = await chatCol.find({ sessionId }).sort({ createdAt: -1 }).limit(4).toArray();
    const query = lastMsgs.reverse().map(h => h.content || '').join(' ');
    console.log('检索 query（最近对话）:', query.slice(0, 80).replace(/\n/g, ' '));
    try {
        const res = await recallMemories(sessionId, query, 20, { excludeResident: true });
        console.log('recallMemories 返回条数:', res.length, '（这些本来都该进上下文，实际进 0 条）');
        let t = 0;
        for (const r of res.slice(0, 13)) {
            const line = fmt(r);
            const tt = estMem(line + '\n');
            t += tt;
            console.log(`  · [${String(tt).padStart(4)}t] ${String(r.title || r.content).slice(0, 40)}`);
        }
        console.log('  前 13 条合计:', t, 'token');
    } catch (e) { console.log('检索失败:', e.message); }

    console.log('\n========== E. 归档/矛盾卡统计（看有没有可回收的）==========');
    console.log('archived:', await col.countDocuments({ sessionId, archived: true }));
    console.log('contradicted:', await col.countDocuments({ sessionId, contradicted: true }));
    console.log('superseded:', await col.countDocuments({ sessionId, supersededBy: { $ne: null } }));
    console.log('critical 总数:', await col.countDocuments({ sessionId, priority: 'critical' }));
    console.log('core+critical 总数:', await col.countDocuments({ sessionId, kind: 'core', priority: 'critical' }));

    await mongoose.disconnect();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
