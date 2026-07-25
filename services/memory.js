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

async function searchMemories(query, limit = 8) {
    try {
        const embedding = await getEmbedding(query);
        if (!embedding) return [];

        // 全量拉取（记忆量不大时直接全量）
        const count = await Memory.countDocuments({});
        let candidates;
        if (count <= 500) {
            candidates = await Memory.find({}).lean();
        } else {
            // 记忆多时粗筛：最近6个月 + 所有critical
            const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
            candidates = await Memory.find({
                $or: [
                    { priority: 'critical' },
                    { timestamp: { $gte: sixMonthsAgo } }
                ]
            }).lean();
        }

        // 计算相似度
        const scored = candidates.map(m => ({
            ...m,
            score: cosineSim(embedding, m.embedding || [])
        }));

        // 排序：critical优先，然后按相似度
        scored.sort((a, b) => {
            if (a.priority === 'critical' && b.priority !== 'critical') return -1;
            if (b.priority === 'critical' && a.priority !== 'critical') return 1;
            return b.score - a.score;
        });

        // 取相似度 > 0.5 的，加上所有 critical 的
        const result = scored.filter(m => m.score > 0.5 || m.priority === 'critical').slice(0, limit);

        // 更新访问记录
        if (result.length > 0) {
            const ids = result.map(m => m._id);
            await Memory.updateMany({ _id: { $in: ids } }, {
                $inc: { accessCount: 1 },
                $set: { lastAccessed: new Date() }
            });
        }

        return result;
    } catch (e) { console.error('记忆检索失败:', e.message); return []; }
}

async function storeMemory(sessionId, content, type = 'fact', priority = 'normal', tags = []) {
    try {
        const embedding = await getEmbedding(content);
        
        // 去重检查：搜索相似度 > 0.92 的已有记忆
        if (embedding) {
            const existing = await Memory.find({ sessionId }).lean();
            for (const m of existing) {
                const sim = cosineSim(embedding, m.embedding || []);
                if (sim > 0.92) {
                    // 更新已有记忆
                    await Memory.findByIdAndUpdate(m._id, {
                        content,
                        embedding: embedding || m.embedding,
                        type,
                        priority: m.priority === 'critical' ? 'critical' : priority,
                        tags: [...new Set([...(m.tags || []), ...tags])],
                        timestamp: Date.now()
                    });
                    console.log(`记忆已更新(相似度${sim.toFixed(2)}): ${content.slice(0, 50)}...`);
                    return;
                }
            }
        }
        
        // 没有相似记忆，新建
        await Memory.create({ sessionId, content, embedding: embedding || [], type, priority, tags });
        console.log(`记忆已存储: ${content.slice(0, 50)}...`);
    } catch (e) { console.error('记忆存储失败:', e.message); }
}

async function cleanupMemories() {
    try {
        const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const result = await Memory.deleteMany({
            priority: 'low',
            lastAccessed: { $lt: threeMonthsAgo },
            accessCount: 0
        });
        console.log(`记忆清理：删除了 ${result.deletedCount} 条无用记忆`);
        return result.deletedCount;
    } catch (e) {
        console.error('记忆清理失败:', e.message);
        return 0;
    }
}

module.exports = { searchMemories, storeMemory, getEmbedding, cleanupMemories };
