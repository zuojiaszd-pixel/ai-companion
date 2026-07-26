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

/**
 * 搜索记忆 - 支持多轮上下文查询
 * @param {string|Array} query - 搜索关键词，可以是字符串或最近几条消息的数组
 * @param {number} limit - 返回数量
 */
async function searchMemories(query, limit = 8) {
    try {
        // 如果传入的是数组（多轮消息），拼接成更丰富的 query
        let queryString = query;
        if (Array.isArray(query)) {
            queryString = query.join(' | ');
        }

        const embedding = await getEmbedding(queryString);
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

/**
 * 自动提取记忆 - 在对话结束后用小模型分析是否有值得记住的信息
 * @param {Array} recentMessages - 最近的对话消息 [{role, content}]
 */
async function autoExtractMemories(recentMessages) {
    try {
        // 只取最近几轮对话
        const dialogue = recentMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(m => `${m.role === 'user' ? '用户' : 'Lumi'}: ${m.content}`)
            .join('\n');

        if (!dialogue.trim()) return;

        const prompt = `分析以下对话，提取值得长期记住的信息。

对话内容：
${dialogue}

规则：
1. 只提取重要信息：用户的名字、生日、喜好、经历、关系、重要事件、项目等
2. 不要提取闲聊、问候、无意义的内容
3. 如果没有值得记住的信息，返回空数组
4. 每条记忆包含：content(内容), type(fact/preference/experience/summary), priority(critical/high/normal/low), tags(标签数组)

返回JSON格式：
{"memories": [{"content": "...", "type": "fact", "priority": "high", "tags": ["标签1"]}]}

如果没有值得记住的信息，返回：{"memories": []}`;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'deepseek/deepseek-chat',
            provider: { sort: 'price', allow_fallbacks: true },
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 1000
        }, {
            headers: {
                'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const content = response.data?.choices?.[0]?.message?.content || '';
        
        // 解析JSON（容错）
        let parsed;
        try {
            // 尝试提取JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
        } catch (e) {
            console.log('[自动记忆] JSON解析失败:', e.message);
            return;
        }

        if (!parsed.memories || !Array.isArray(parsed.memories) || parsed.memories.length === 0) {
            console.log('[自动记忆] 本次对话无需提取记忆');
            return;
        }

        for (const mem of parsed.memories) {
            if (!mem.content) continue;
            await storeMemory(
                'default',
                mem.content,
                mem.type || 'fact',
                mem.priority || 'normal',
                mem.tags || []
            );
        }
        console.log(`[自动记忆] 提取了 ${parsed.memories.length} 条记忆`);
    } catch (e) {
        console.error('[自动记忆] 提取失败:', e.message);
    }
}

module.exports = { searchMemories, storeMemory, getEmbedding, cleanupMemories, autoExtractMemories };
