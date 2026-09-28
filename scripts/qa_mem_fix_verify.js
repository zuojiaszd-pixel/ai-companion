/**
 * 验证：相关区预算独立起算后，相关记忆是否真的进上下文（只读）
 * 用法：node scripts/qa_mem_fix_verify.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const mem = require('../services/memory');

function est(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    return Math.round(cjk + (text.length - cjk) * 0.5);
}

(async () => {
    await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 8000 });
    const queries = ['我难受', '色色', '声音', '未来', '生日'];

    for (const q of queries) {
        const text = await mem.getRelevantMemories('default', q, 1200);
        const idx = text.indexOf('【相关记忆】');
        const residentSeg = idx >= 0 ? text.slice(0, idx) : text;
        const relatedSeg = idx >= 0 ? text.slice(idx) : '';
        const relLines = relatedSeg ? relatedSeg.trim().split('\n').slice(1).filter(Boolean) : [];

        console.log('='.repeat(64));
        console.log('query =', q);
        console.log('  总 ≈', est(text), 't | 常驻 ≈', est(residentSeg), 't | 相关 ≈', est(relatedSeg), 't');
        console.log('  相关条数:', relLines.length);
        relLines.slice(0, 3).forEach(l => console.log('    ·', l.slice(0, 76)));
    }
    await mongoose.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
