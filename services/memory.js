const axios = require('axios');
const Memory = require('../models/Memory');

async function getEmbedding(text) {
    const res = await axios.post('https://openrouter.ai/api/v1/embeddings', {
        model: 'openai/text-embedding-3-small', input: text
    }, {
        headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 10000
    });
    return res.data?.data?.[0]?.embedding || null;
}

function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, mA = 0, mB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; mA += a[i] * a[i]; mB += b[i] * b[i]; }
    mA = Math.sqrt(mA); mB = Math.sqrt(mB);
    return (mA && mB) ? dot / (mA * mB) : 0;
}

async function searchMemories(query, limit = 5) {
    try {
        const embedding = await getEmbedding(query);
        if (!embedding) return [];
        const all = await Memory.find({}).sort({ timestamp: -1 }).limit(200).lean();
        const scored = all.map(m => ({ ...m, score: cosineSim(embedding, m.embedding || []) }));
        scored.sort((a, b) => b.score - a.score);
        return scored.filter(m => m.score > 0.5).slice(0, limit);
    } catch (e) { console.error('记忆检索失败:', e.message); return []; }
}

async function storeMemory(sessionId, content, type = 'fact') {
    try {
        const embedding = await getEmbedding(content);
        await Memory.create({ sessionId, content, embedding: embedding || [], type });
        console.log(`记忆已存储: ${content.slice(0, 50)}...`);
    } catch (e) { console.error('记忆存储失败:', e.message); }
}

module.exports = { searchMemories, storeMemory, getEmbedding };