/**
 * 只读 token 体检脚本（2026-09-29）
 * 目的：把每轮真实进 prompt 的每块内容占多少 token 打出来。
 * 不修改任何生产代码、不写库、不调模型。
 * 用法：node scripts/qa_token_audit.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ---- 复刻 memory.js 的估算（常驻区实际用的是这个）----
function estMem(text) {
    if (!text) return 0;
    text = String(text);
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    return Math.round(cjk + (text.length - cjk) * 0.5);
}
// ---- 复刻 chat.js 的估算（历史预算用的是这个）----
function estChat(str) {
    if (!str) return 0;
    if (typeof str !== 'string') str = String(str);
    const cjk = (str.match(/[\u3000-\u303f\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
    const other = str.length - cjk;
    return Math.ceil(cjk * 1.0 + other * 0.35) + 4;
}

function fmt(m, withFields) {
    let line = `[${m.kind || 'core'}/${m.priority || 'normal'}] ${m.content || ''}`;
    const parts = { content: estMem(m.content || '') };
    if (m.title) { line += `（${m.title}）`; parts.title = estMem(m.title); }
    if (m.lumiThought) { line += ` Lumi想法：${m.lumiThought}`; parts.lumiThought = estMem(m.lumiThought); }
    const emotions = (m.emotions || []).slice(-3).map(e =>
        `${e.emotion}${e.intensity != null ? `(${e.intensity}/10)` : ''}`).join('、');
    if (emotions) { line += ` 情绪：${emotions}`; parts.emotions = estMem(emotions); }
    const timeline = (m.timeline || []).slice(-3).map(t => `${t.date} ${t.event}`).join('；');
    if (timeline) { line += ` 时间线：${timeline}`; parts.timeline = estMem(timeline); }
    return withFields ? { line, parts } : line;
}

(async () => {
    await mongoose.connect(process.env.DATABASE_URL);
    const col = mongoose.connection.db.collection('memories');
    const sessionId = 'default';

    console.log('========== 1. 固定 system prompt ==========');
    const { PERSONA } = require('../config/persona');
    const coreMemory = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/core_memory.json'), 'utf8'));
    const coreMemoryPrompt = `\n【核心记忆 - 每次必须加载】\n伴侣名字：${coreMemory.partner_name}（绝对不能叫"用户"）\n在一起日期：${coreMemory.relationship_start}\n谁先表白：${coreMemory.who_confessed}\n名字含义：${coreMemory.name_meaning}\n关键事实：${coreMemory.key_facts.map(f => '\n- ' + f).join('')}\n`;
    const thinking = '\n\n【思考语言】你的内心思考（reasoning/思考链）必须全程用中文写，禁止用英文打腹稿。Rinka会看你的思考链，她看不懂英文。';
    console.log('PERSONA              :', estChat(PERSONA), 'token /', PERSONA.length, '字符');
    console.log('coreMemoryPrompt     :', estChat(coreMemoryPrompt), 'token /', coreMemoryPrompt.length, '字符');
    console.log('思考语言指令          :', estChat(thinking), 'token');
    const staticPrompt = PERSONA + coreMemoryPrompt + thinking;
    console.log('STATIC_SYSTEM_PROMPT :', estChat(staticPrompt), 'token（含+4开销）');

    console.log('\n========== 2. 常驻区（真实 DB，10 张 critical）==========');
    const resident = await col.find({
        sessionId, kind: 'core', priority: 'critical',
        supersededBy: null, contradicted: false, archived: false
    }).project({ embedding: 0 }).sort({ updatedAt: -1 }).limit(10).toArray();

    console.log('取到卡片数:', resident.length);
    const RESIDENT_TOKEN_CAP = parseInt(process.env.RESIDENT_TOKEN_CAP) || 2500;
    console.log('代码里的 RESIDENT_TOKEN_CAP =', RESIDENT_TOKEN_CAP);
    let residentTokens = 0, kept = 0, dropped = [];
    const fieldSum = { content: 0, title: 0, lumiThought: 0, emotions: 0, timeline: 0 };
    for (const r of resident) {
        const { line, parts } = fmt(r, true);
        const t = estMem(line + '\n');
        for (const k of Object.keys(fieldSum)) fieldSum[k] += (parts[k] || 0);
        if (residentTokens + t > RESIDENT_TOKEN_CAP) {
            dropped.push({ t, title: r.title || String(r.content).slice(0, 20), updatedAt: r.updatedAt });
            continue;
        }
        residentTokens += t; kept++;
    }
    console.log('实际进上下文:', kept, '张，合计', residentTokens, 'token');
    console.log('被上限挤掉:', dropped.length, '张', dropped.map(d => `[${d.t}t]${d.title}`).join(' '));
    console.log('字段占用拆分（token）:', JSON.stringify(fieldSum));
    console.log('→ lumiThought 占比:', (fieldSum.lumiThought / residentTokens * 100).toFixed(1) + '%',
        '| emotions 占比:', (fieldSum.emotions / residentTokens * 100).toFixed(1) + '%');

    console.log('\n========== 3. 相关区（关键：预算是否被常驻区吃光）==========');
    const maxTokens = 1200; // chat.js 传入的实参
    console.log('getRelevantMemories 的 maxTokens 实参 =', maxTokens);
    // 复刻 memory.js 里的算法
    let text = '';
    if (residentTokens > 0) text += '【常驻记忆】\n' + 'x'.repeat(0) + '\n'; // 占位，实际下面用真实串重算
    // 用真实常驻串重算
    let realResidentText = '';
    { let acc = 0;
      for (const r of resident) {
        const line = fmt(r) + '\n';
        const t = estMem(line);
        if (acc + t > RESIDENT_TOKEN_CAP) break;
        realResidentText += line; acc += t;
      }
    }
    text = '【常驻记忆】\n' + realResidentText + '\n【相关记忆】\n';
    let tokenEstimate = estMem(text);
    console.log('起始 tokenEstimate（已含常驻区+相关区标题）=', tokenEstimate);
    console.log('maxTokens =', maxTokens);
    if (tokenEstimate > maxTokens) {
        console.log('⚠️  起始值已超预算 → 循环第一次判断就 break，相关记忆一条都进不来');
    }
    console.log('实际拼出的注入串长度:', text.length, '字符 /', estMem(text), 'token');
    console.log('末尾是否留了空标题:', JSON.stringify(text.slice(-12)));

    console.log('\n========== 4. 对话历史 ==========');
    const total = await col.countDocuments({ sessionId });
    console.log('记忆库总条数:', total);
    const chatCol = mongoose.connection.db.collection('chats');
    const totalChats = await chatCol.countDocuments({ sessionId });
    console.log('聊天记录总条数:', totalChats);
    const last100 = await chatCol.find({ sessionId }).sort({ createdAt: -1 }).limit(100).toArray();
    let histTokens = 0;
    for (const h of last100) histTokens += estChat(h.content || '');
    console.log('最近 100 条聊天记录:', histTokens, 'token');
    const last15 = last100.slice(0, 15);
    let h15 = 0; for (const h of last15) h15 += estChat(h.content || '');
    console.log('最近 15 条聊天记录:', h15, 'token');

    console.log('\n========== 5. 摘要块 ==========');
    try {
        const s = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/conversation_summary.json'), 'utf8'));
        console.log('摘要字数:', (s.summary || '').length, '| token ≈', estChat(s.summary || ''));
        console.log('更新时间:', s.updatedAt, '| 是否 24h 内:', s.updatedAt ? ((Date.now() - new Date(s.updatedAt).getTime()) / 3600000 < 24) : false);
    } catch (e) { console.log('读摘要失败:', e.message); }

    console.log('\n========== 6. settings 实际值 ==========');
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/settings.json'), 'utf8'));
    console.log('contextRounds =', st.contextRounds, '| contextTokens =', st.contextTokens, '| maxTokens =', st.maxTokens);

    console.log('\n========== 汇总：每轮真实输入构成 ==========');
    const sysTotal = estChat(staticPrompt) + estMem(text);
    const contextTokens = Math.min(parseInt(st.contextTokens) || 12000, 24000);
    const historyBudget = Math.max(contextTokens - sysTotal - 0, 2000);
    console.log('① STATIC_SYSTEM_PROMPT      :', estChat(staticPrompt));
    console.log('② 记忆注入（常驻+相关）      :', estMem(text));
    console.log('③ 摘要                      :', '见上');
    console.log('①②合计                      :', sysTotal);
    console.log('contextTokens 预算           :', contextTokens);
    console.log('→ 留给历史对话的预算          :', historyBudget, `（约占 ${(historyBudget / contextTokens * 100).toFixed(0)}%）`);
    console.log('→ 常驻区占 ② 的比例           :', (residentTokens / estMem(text) * 100).toFixed(0) + '%');

    await mongoose.disconnect();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
