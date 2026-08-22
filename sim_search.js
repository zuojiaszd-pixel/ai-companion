require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const tokenize = (text) => {
    const normalized = String(text || '').toLowerCase();
    const tokens = [];
    const chunks = normalized.match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) || [];
    for (const chunk of chunks) {
        if (/^[\u4e00-\u9fff]+$/.test(chunk)) {
            if (chunk.length === 1) tokens.push(chunk);
            else for (let i = 0; i < chunk.length - 1; i++) tokens.push(chunk.slice(i, i + 2));
        } else {
            tokens.push(chunk);
        }
    }
    return tokens;
};

(async () => {
  await mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/ai-companion');
  const Memory = require(path.join(process.cwd(), 'models', 'Memory.js'));
  const cards = await Memory.find({ supersededBy: null, archived: false }).select('title content tags priority').lean();
  console.log('总卡数:', cards.length);

  const qTokens = tokenize('引导');
  console.log('查询token:', qTokens);

  const scored = cards.map(m => {
    const contentTokens = new Set(tokenize(m.content));
    const tagTokens = new Set(tokenize((m.tags || []).join(' ')));
    const contentMatch = qTokens.filter(t => contentTokens.has(t)).length;
    const tagMatch = qTokens.filter(t => tagTokens.has(t)).length;
    const keywordScore = qTokens.length > 0 ? (contentMatch + tagMatch * 3) / qTokens.length : 0;
    return { title: m.title, priority: m.priority, contentMatch, tagMatch, keywordScore, tags: m.tags, content: (m.content||'').slice(0,40) };
  }).filter(s => s.keywordScore > 0).sort((a,b) => b.keywordScore - a.keywordScore);

  console.log('=== keywordScore > 0 的卡（关键词层面排名）===');
  scored.forEach((s, i) => {
    console.log(`#${i+1} [${s.priority}] contentMatch=${s.contentMatch} tagMatch=${s.tagMatch} score=${s.keywordScore.toFixed(2)} | ${s.title || '(无标题)'} | ${s.content}...`);
  });

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
