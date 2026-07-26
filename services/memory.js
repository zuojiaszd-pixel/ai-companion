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
 */
async function searchMemories(query, limit = 8) {
    try {
        let queryString = query;
        if (Array.isArray(query)) {
            queryString = query.join(' | ');
        }

        const embedding = await getEmbedding(queryString);
        if (!embedding) return [];

        const count = await Memory.countDocuments({});
        let candidates;
        if (count <= 500) {
            candidates = await Memory.find({}).lean();
        } else {
            const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
            candidates = await Memory.find({
                $or: [
                    { priority: 'critical' },
                    { timestamp: { $gte: sixMonthsAgo } }
                ]
            }).lean();
        }

        const scored = candidates.map(m => ({
            ...m,
            score: cosineSim(embedding, m.embedding || [])
        }));

        scored.sort((a, b) => {
            if (a.priority === 'critical' && b.priority !== 'critical') return -1;
            if (b.priority === 'critical' && a.priority !== 'critical') return 1;
            return b.score - a.score;
        });

        const result = scored.filter(m => m.score > 0.5 || m.priority === 'critical').slice(0, limit);

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
        
        // 去重检查：相似度 > 0.85 的已有记忆，更新而非新建
        if (embedding) {
            const existing = await Memory.find({ sessionId }).lean();
            for (const m of existing) {
                const sim = cosineSim(embedding, m.embedding || []);
                if (sim > 0.85) {
                    // 保留更高的优先级
                    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
                    const existingPriority = priorityOrder[m.priority] ?? 2;
                    const newPriority = priorityOrder[priority] ?? 2;
                    const finalPriority = existingPriority <= newPriority ? m.priority : priority;
                    
                    await Memory.findByIdAndUpdate(m._id, {
                        content,
                        embedding: embedding || m.embedding,
                        type,
                        priority: finalPriority,
                        tags: [...new Set([...(m.tags || []), ...tags])],
                        timestamp: Date.now()
                    });
                    console.log(`记忆已更新(相似度${sim.toFixed(2)}): ${content.slice(0, 50)}...`);
                    return;
                }
            }
        }
        
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
 */
async function autoExtractMemories(recentMessages) {
    try {
        const dialogue = recentMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(m => `${m.role === 'user' ? '用户' : 'Lumi'}: ${m.content}`)
            .join('\n');

        if (!dialogue.trim()) return;

        const prompt = `分析以下对话，提取值得长期记住的信息。

对话内容：
${dialogue}

【严格规则】
1. 只提取真正重要的信息：用户的名字、生日、重大人生事件、重要偏好、关系里程碑、项目信息、明确约定
2. 绝对不要提取以下内容：
   - 闲聊、问候、日常寒暄（"上床了""明天干嘛"等）
   - 技术调试过程、bug描述、代码修改细节
   - 对话中已经反复确认过的重复信息（如果之前已经记过类似内容，不要重复提取）
   - Lumi自己的临时感受或想法（除非是重大价值观表态）
   - 临时性、一次性的对话内容
3. 宁可漏掉也不要记垃圾。如果不确定是否值得记，就不记。
4. 每条记忆包含：content(简洁明确的内容), type(fact/preference/experience/summary), priority(critical/high/normal/low), tags(标签数组)
5. priority说明：critical=名字/生日/纪念日等核心信息，high=重要偏好/约定/项目，normal=有价值的背景信息，low=琐碎

返回JSON格式：
{"memories": [{"content": "...", "type": "fact", "priority": "high", "tags": ["标签1"]}]}

如果没有值得记住的信息，返回：{"memories": []}`;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'z-ai/glm-5.2',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: 800
        }, {
            headers: {
                'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const content = response.data?.choices?.[0]?.message?.content || '';
        
        let parsed;
        try {
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
            // 基本长度检查，太短的通常是垃圾
            if (mem.content.length < 5) continue;
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
