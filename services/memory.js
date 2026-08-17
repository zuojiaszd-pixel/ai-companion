const axios = require('axios');
const Memory = require('../models/Memory');
const fs = require('fs').promises;
const path = require('path');

// ============ 基础工具函数 ============

function withHardTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timer = setTimeout(() => {
                clearTimeout(timer);
                reject(new Error(`timeout ${ms}ms`));
            }, ms);
        })
    ]);
}

async function getEmbedding(text) {
    try {
        const res = await axios.post('https://openrouter.ai/api/v1/embeddings', {
            model: 'text-embedding-3-small',
            input: text
        }, {
            headers: {
                'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 3000
        });
        return res.data.data[0].embedding;
    } catch (e) {
        console.warn('[Memory] embedding 获取失败，降级为关键词检索:', e.message);
        return null;
    }
}

function hasSharedMemoryTopic(contentA, contentB) {
    const tokensA = new Set(tokenize(contentA || ''));
    const tokensB = new Set(tokenize(contentB || ''));
    if (tokensA.size === 0 || tokensB.size === 0) return false;

    let overlap = 0;
    for (const token of tokensA) {
        if (tokensB.has(token)) overlap++;
    }
    const smallerSize = Math.min(tokensA.size, tokensB.size);
    // 向量很相似但没有共同主题词时，不自动合并/判定矛盾，避免把两件事混成一条记忆。
    // 短内容要求更严格；较长内容允许共享一个以上主题词。
    if (smallerSize <= 2) return overlap === smallerSize;
    return overlap >= 2 || overlap / smallerSize >= 0.25;
}

function cosineSim(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text) {
    // 中文通常没有空格，按连续汉字生成二元词，避免整句被当成一个 token，
    // 也让“外贸询盘”和“外贸英文询盘”能够共享“外贸/询盘”等主题词。
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
}

// 从内容中提取主题标签（关键词）
function extractTagsFromContent(content) {
    const tokens = tokenize(content);
    const stopwords = new Set([
        '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', 
        '这', '那', '和', '与', '或', '也', '都', '就', '不', '没', 
        '有', '要', '会', '能', '可以', '这个', '那个', '什么', '怎么',
        '一个', '我们', '他们', '她们', '因为', '所以', '但是', '如果',
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'he',
        'she', 'it', 'we', 'they', 'and', 'or', 'but', 'to', 'of', 'in',
        'on', 'at', 'for', 'with', 'that', 'this', 'be', 'have', 'do'
    ]);
    
    const wordCount = {};
    for (const t of tokens) {
        if (!stopwords.has(t) && t.length > 1) {
            wordCount[t] = (wordCount[t] || 0) + 1;
        }
    }
    
    const sorted = Object.entries(wordCount).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 5).map(([word]) => word);
}

// 解析复合情绪标签："兴奋+成就感" → [{emotion:"兴奋"},{emotion:"成就感"}]
function parseCompoundMood(mood) {
    if (!mood) return [];
    return mood.split('+').map(m => m.trim()).filter(m => m.length > 0);
}

// 将旧类型映射到当前的三类体系；保留 legacyType 便于旧数据和接口兼容。
function normalizeMemoryType(type) {
    const legacyTypes = new Set(['fact', 'preference', 'experience', 'summary']);
    if (legacyTypes.has(type)) return { type: 'core', legacyType: type };
    if (['core', 'tech', 'state'].includes(type)) return { type, legacyType: null };
    return { type: 'core', legacyType: null };
}

// ============ 多Query生成 ============

function generateMultiQueries(query) {
    const queries = [query];
    const tokens = tokenize(query);
    const stopwords = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '和', '与', '或', '也', '都', '就', '不', '没', '有', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for']);
    const filtered = tokens.filter(t => !stopwords.has(t));
    if (filtered.length > 0 && filtered.length < tokens.length) {
        queries.push(filtered.join(' '));
    }
    return queries;
}

// ============ 解除归档 ============

async function unarchiveMemory(memoryId) {
    try {
        const memory = await Memory.findById(memoryId);
        if (!memory || !memory.archived) return null;
        
        memory.embedding = await getEmbedding(memory.content);
        memory.archived = false;
        memory.archivedAt = null;
        memory.embeddingArchived = false;
        memory.heat = memory.baseHeat * 0.5;
        await memory.save();
        
        console.log(`[Memory] 解除归档: "${memory.content.slice(0, 30)}..."`);
        return memory;
    } catch (e) {
        console.error('[Memory] 解除归档失败:', e.message);
        return null;
    }
}

// ============ 归档区关键词检索 ============

async function keywordSearchArchived(sessionId, query, limit) {
    limit = limit || 10;
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    
    const archived = await Memory.find({
        sessionId,
        archived: true,
        supersededBy: null
    }).select('-embedding').limit(100).lean();
    
    const scored = archived.map(m => {
        const contentTokens = tokenize(m.content + ' ' + (m.tags || []).join(' '));
        const matchCount = queryTokens.filter(t => contentTokens.includes(t)).length;
        const score = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
        return { memory: m, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > 0).slice(0, limit);
}

// ============ 关联联想检索 ============

async function findRelatedByTags(sessionId, tagSet, excludeIds) {
    if (!tagSet || tagSet.length === 0) return [];
    const related = await Memory.find({
        sessionId,
        archived: false,
        supersededBy: null,
        contradicted: false,
        relatedTags: { $in: tagSet },
        _id: { $nin: excludeIds }
    }).select('-embedding').limit(8).lean();
    
    return related;
}

// ============ 存储记忆（带去重逻辑 + 自动提取标签） ============

async function saveMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood, options) {
    try {
        // Phase 2：options 携带档案卡片字段（kind/title/lumiThought）
        options = options || {};
        const kind = options.kind || 'core';
        const normalizedType = normalizeMemoryType(type || 'core');
        const canonicalType = normalizedType.type;
        const title = options.title || null;
        const lumiThought = options.lumiThought || null;
        // 情绪是必要条件：core 类型必须带情绪
        if (canonicalType === 'core' && !mood) {
            mood = 'neutral';
            moodIntensity = 0.5;
            console.log(`[Memory] 核心记忆默认情绪: neutral`);
        }
        
        const embedding = await getEmbedding(content);
        const defaults = Memory.applyPriorityDefaults(priority);
        
        // 自动提取主题标签
        const autoTags = extractTagsFromContent(content);
        // 自动标签和手动标签统一写入 tags：检索、列表和关联联想看到的是同一套标签。
        // relatedTags 继续保留，兼容已有数据和关联检索逻辑。
        const mergedTags = [...new Set([...(tags || []), ...autoTags])];
        const mergedRelatedTags = mergedTags.slice();
        
        const existing = await Memory.find({ 
            sessionId, 
            supersededBy: null,
            contradicted: false,
            archived: false,
            type: { $in: ['core', 'tech', 'state', 'fact', 'preference', 'experience', 'summary'] }
        });
        
                // ====== 融合更新（相似度 > 0.78 触发合并） ======
        for (const m of existing) {
            const sim = cosineSim(embedding, m.embedding || []);
            if (sim > 0.78 && (content === m.content || hasSharedMemoryTopic(content, m.content))) {
                m.accessCount += 1;
                m.lastAccessed = new Date();
                m.heat = Math.max(m.heat, m.baseHeat) * 1.2;
                
                // ====== Phase 3 精简版：融合不再硬拼接 content ======
                // 主内容保持精炼正文不膨胀，新信息追加为 timeline 事件（完整内容，不丢信息）
                // version 由 addTimelineEvent 自动递增；relatedTags 由下方公共代码合并
                if (content !== m.content) {
                    const newTokens = new Set(tokenize(content));
                    const existingTokens = new Set(tokenize(m.content));
                    const extraTokens = [...newTokens].filter(t => !existingTokens.has(t));
                    const extraRatio = extraTokens.length / Math.max(newTokens.size, 1);
                    
                    if (extraRatio > 0.1) {
                        const now = new Date();
                        const dateStr = now.toISOString().split('T')[0];
                        m.addTimelineEvent(dateStr, content);
                        
                        console.log(`[Memory] 融合(Phase 3): ${extraTokens.length}个信息点追加为时间线, 主内容未膨胀, v${m.version}`);
                    }
                }
                
                // 情绪融合：复合情绪支持
                if (mood) {
                    const moodParts = parseCompoundMood(mood);
                    for (const mp of moodParts) {
                        m.addEmotion(mp, moodIntensity || 0.5, `Lumi感知`);
                    }
                    // 向下兼容：旧的 mood 字段保留主情绪
                    if (moodParts.length > 0) {
                        m.mood = moodParts[0];
                        m.moodIntensity = moodIntensity || 0.5;
                    }
                }
                m.lumiMood = lumiMood || m.lumiMood || null;
                
                // 优先级提升
                const priorityOrder = ['low', 'normal', 'high', 'critical'];
                if (priority && priorityOrder.indexOf(priority) > priorityOrder.indexOf(m.priority)) {
                    m.priority = priority;
                }
                
                if (mergedTags.length > 0) {
                    const existingTags = new Set(m.tags || []);
                    mergedTags.forEach(t => existingTags.add(t));
                    m.tags = Array.from(existingTags);
                }
                
                // Phase 2：新卡片带了 title/lumiThought 而旧卡片没有，补上（不覆盖已有想法）
                if (title && !m.title) m.title = title;
                if (lumiThought && !m.lumiThought) m.lumiThought = lumiThought;
                const existingRelated = new Set(m.relatedTags || []);
                mergedRelatedTags.forEach(t => existingRelated.add(t));
                m.relatedTags = Array.from(existingRelated);
                
                await m.save();
                console.log(`[Memory] 融合完成: "${content.slice(0, 30)}..." (热度: ${m.heat.toFixed(2)}, v${m.version})`);
                return m;
            }
        }
        
        // ====== 矛盾检测（0.70 ~ 0.78） ======
        const supersededIds = [];
        for (const m of existing) {
            const sim = cosineSim(embedding, m.embedding || []);
            if (sim > 0.70 && m.content !== content && hasSharedMemoryTopic(content, m.content)) {
                m.contradicted = true;
                m.supersededBy = null;
                await m.save();
                supersededIds.push(m._id);
                console.log(`[Memory] 矛盾检测: "${m.content.slice(0, 30)}..." -> "${content.slice(0, 30)}..."`);
            }
        }
        
        // ====== 复合情绪构建 ======
        const moodParts = parseCompoundMood(mood);
        const emotions = moodParts.length > 0
            ? moodParts.map(mp => ({
                emotion: mp,
                intensity: typeof moodIntensity === 'number' ? moodIntensity : 0.5,
                context: 'Lumi感知',
                time: new Date()
              }))
            : [];
        
        const newMemory = await Memory.create({
            sessionId,
            content,
            embedding: embedding || [],
            // 新类型体系：默认 core（关于我们的回忆），tech 需主动指定
            type: canonicalType,
            legacyType: normalizedType.legacyType,
            priority: priority || 'normal',
            tags: mergedTags,
            mood: mood ? moodParts[0] || mood : null,
            moodIntensity: mood ? (typeof moodIntensity === "number" ? moodIntensity : 0.5) : null,
            lumiMood: lumiMood || null,
            // 结构化情绪记录
            emotions: emotions.length > 0 ? emotions : [],
            // 档案卡片字段（Phase 2）
            kind,
            title,
            lumiThought,
            // TTL：已废除自动遗忘，不再为任何类型设置过期时间
            ttl: null,
            heat: defaults.baseHeat,
            baseHeat: defaults.baseHeat,
            halfLife: defaults.halfLife,
            lastAccessed: new Date(),
            accessCount: 0,
            locked: false,
            archived: false,
            relatedTags: mergedRelatedTags
        });
        
        // 一个新事实可能替代多条旧记录，全部接入同一条当前版本，避免留下
        // contradicted=true 但 supersededBy=null 的断链记忆。
        if (supersededIds.length > 0) {
            const supersededUpdate = buildSupersededUpdate(supersededIds, newMemory._id);
            await Memory.updateMany(supersededUpdate.filter, supersededUpdate.update);
        }
        
        console.log(`[Memory] 已存储: ${content.slice(0, 50)}... [${canonicalType}/${priority}] [旧类型:${normalizedType.legacyType || '无'}] 情绪: ${mood || '无'} 标签: [${mergedRelatedTags.join(', ')}]`);
        return newMemory;
    } catch (e) {
        console.error('[Memory] 存储失败:', e.message);
        return null;
    }
}

// ============ 检索记忆（多Query + RRF + 归档补充 + 关联联想） ============

async function recallMemories(sessionId, query, topK, opts = {}) {
    topK = topK || 10;
    try {
        const multiQueries = generateMultiQueries(query);
        const embeddings = await Promise.all(multiQueries.map(q => withHardTimeout(getEmbedding(q), 3000).catch(() => null)));

        const filter = {
            sessionId,
            supersededBy: null,
            contradicted: false,
            archived: false
        };
        if (opts.excludeResident) {
            // 常驻级卡片（kind=core 且 priority=critical）由 getRelevantMemories 单独加载，按需检索排除它们
            filter.$or = [
                { kind: { $ne: 'core' } },
                { priority: { $ne: 'critical' } }
            ];
        }

        const candidates = await withHardTimeout(
            Memory.find(filter)
                .select('-embedding')
                .sort({ createdAt: -1 })
                .limit(100)
                .maxTimeMS(3000)
                .lean(),
            3000
        ).catch(() => []);

        if (candidates.length === 0) return [];

        const poolIds = candidates.map(c => c._id);
        const embDocs = await withHardTimeout(
            Memory.find({ _id: { $in: poolIds } })
                .select('_id embedding')
                .lean(),
            3000
        ).catch(() => []);
        const embMap = new Map(embDocs.map(d => [d._id.toString(), d.embedding || []]));

        const rrfK = 60;
        const rrfScores = new Map();

        for (let qi = 0; qi < multiQueries.length; qi++) {
            const queryEmbedding = embeddings[qi];
            const queryTokens = tokenize(multiQueries[qi]);

            // 关键词 RRF 不依赖 embedding，保证 embedding 失败时仍能召回
            const keywordRanked = candidates.map(m => {
                const contentTokens = tokenize(m.content + ' ' + (m.tags || []).join(' '));
                const matchCount = queryTokens.filter(t => contentTokens.includes(t)).length;
                const keywordScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
                return { memory: m, keywordScore };
            });
            keywordRanked.sort((a, b) => b.keywordScore - a.keywordScore);

            keywordRanked.forEach((item, rank) => {
                const id = item.memory._id.toString();
                const score = rrfScores.get(id) || { item, score: 0 };
                score.score += 1 / (rrfK + rank + 1);
                rrfScores.set(id, score);
            });

            if (!queryEmbedding) continue;

            // 向量 RRF 只对候选池里有 embedding 的成员算
            const vectorRanked = candidates
                .filter(m => embMap.has(m._id.toString()) && embMap.get(m._id.toString()).length > 0)
                .map(m => ({
                    memory: m,
                    vectorScore: cosineSim(queryEmbedding, embMap.get(m._id.toString()) || [])
                }));
            vectorRanked.sort((a, b) => b.vectorScore - a.vectorScore);

            vectorRanked.forEach((item, rank) => {
                const id = item.memory._id.toString();
                const score = rrfScores.get(id) || { item, score: 0 };
                score.score += 1 / (rrfK + rank + 1);
                rrfScores.set(id, score);
            });
        }
        
        const RECENT_WINDOW_DAYS = 7;
        const RECENT_BONUS = 0.08;
        const now = new Date();
        
        const ranked = Array.from(rrfScores.values()).map(entry => {
            const m = entry.item.memory;
            const lastAccess = m.lastAccessed || m.createdAt || now;
            const daysSinceAccess = (now - new Date(lastAccess)) / 86400000;
            const heat = m.locked
                ? (m.baseHeat || 1.0)
                : (m.baseHeat || 1.0) * Math.pow(0.5, daysSinceAccess / (m.halfLife || 30));
            const priorityBoost = { critical: 0.3, high: 0.15, normal: 0, low: -0.1 }[m.priority] || 0;
            const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
            const recentBonus = ageDays <= RECENT_WINDOW_DAYS ? RECENT_BONUS * (1 - ageDays / RECENT_WINDOW_DAYS) : 0;
            entry.finalScore = entry.score + heat * 0.05 + priorityBoost + recentBonus;
            return entry;
        });
        
        ranked.sort((a, b) => b.finalScore - a.finalScore);
        
        const topResults = ranked.slice(0, topK);
        
        const results = topResults.map(entry => {
            return {
                _id: entry.item.memory._id,
                content: entry.item.memory.content,
                kind: entry.item.memory.kind || 'core',
                title: entry.item.memory.title || null,
                lumiThought: entry.item.memory.lumiThought || null,
                type: entry.item.memory.type,
                priority: entry.item.memory.priority,
                tags: entry.item.memory.tags,
                mood: entry.item.memory.mood || null,
                moodIntensity: entry.item.memory.moodIntensity || null,
                lumiMood: entry.item.memory.lumiMood || null,
                // 让上层真正拿到结构化情绪与时间线，不再只暴露旧的单值字段
                emotions: entry.item.memory.emotions || [],
                timeline: entry.item.memory.timeline || [],
                version: entry.item.memory.version || 1,
                relatedTags: entry.item.memory.relatedTags || [],
                score: entry.finalScore,
                createdAt: entry.item.memory.createdAt
            };
        });
        
        await Promise.all(topResults.map(entry => {
            const id = entry.item.memory._id;
            return Memory.updateOne(
                { _id: id },
                [{ $set: {
                    accessCount: { $add: ['$accessCount', 1] },
                    lastAccessed: new Date(),
                    heat: { $max: ['$heat', '$baseHeat'] },
                    updatedAt: new Date()
                } }]
            ).catch(() => {});
        }));
        
        // 关联联想：从命中结果中收集标签，找同标签的其他记忆
        const hitTags = new Set();
        topResults.forEach(entry => {
            const m = entry.item.memory;
            if (m.relatedTags && m.relatedTags.length > 0) {
                m.relatedTags.forEach(t => hitTags.add(t));
            }
        });
        
        if (hitTags.size > 0) {
            const excludeIds = topResults.map(e => e.item.memory._id);
            const relatedMemories = await findRelatedByTags(sessionId, Array.from(hitTags), excludeIds);
            
            const relatedScores = relatedMemories.map(m => {
                // 计算标签重叠度
                const overlap = (m.relatedTags || []).filter(t => hitTags.has(t)).length;
                const tagScore = overlap / Math.max(hitTags.size, 1);
                return {
                    _id: m._id,
                    content: m.content,
                    kind: m.kind || 'core',
                    title: m.title || null,
                    lumiThought: m.lumiThought || null,
                    type: m.type,
                    priority: m.priority,
                    tags: m.tags,
                    mood: m.mood || null,
                    moodIntensity: m.moodIntensity || null,
                    lumiMood: m.lumiMood || null,
                    emotions: m.emotions || [],
                    timeline: m.timeline || [],
                    version: m.version || 1,
                    relatedTags: m.relatedTags || [],
                    score: tagScore * 0.5,
                    createdAt: m.createdAt
                };
            });
            
            relatedScores.sort((a, b) => b.score - a.score);
            const topRelated = relatedScores.slice(0, 3);
            
            // 只加不重复且有关联价值的
            const resultIds = new Set(results.map(r => r._id.toString()));
            for (const r of topRelated) {
                if (!resultIds.has(r._id.toString())) {
                    results.push(r);
                    resultIds.add(r._id.toString());
                }
            }
            
            if (topRelated.length > 0) {
                console.log(`[Memory] 关联联想补充: ${topRelated.length}条`);
            }
        }
        
        // 活跃区不足时补充归档
        let archivedRecovered = 0;
        if (results.length < topK / 2) {
            const archivedHits = await keywordSearchArchived(sessionId, query, topK - results.length);
            for (const hit of archivedHits) {
                const unarchived = await unarchiveMemory(hit.memory._id);
                if (unarchived) {
                    results.push({
                        _id: unarchived._id,
                        content: unarchived.content,
                        kind: unarchived.kind || 'core',
                        title: unarchived.title || null,
                        lumiThought: unarchived.lumiThought || null,
                        type: unarchived.type,
                        priority: unarchived.priority,
                        tags: unarchived.tags,
                        mood: unarchived.mood || null,
                        moodIntensity: unarchived.moodIntensity || null,
                        lumiMood: unarchived.lumiMood || null,
                        emotions: unarchived.emotions || [],
                        timeline: unarchived.timeline || [],
                        version: unarchived.version || 1,
                        relatedTags: unarchived.relatedTags || [],
                        score: hit.score * 0.3,
                        createdAt: unarchived.createdAt
                    });
                    archivedRecovered++;
                }
            }
            results.sort((a, b) => b.score - a.score);
        }
        
        console.log(`[Memory] 检索完成: ${results.length}条${archivedRecovered > 0 ? `(含${archivedRecovered}条归档恢复)` : ''}`);
        return results;
    } catch (e) {
        console.error('[Memory] 检索失败:', e.message);
        return [];
    }
}

// ============ 分层注入 ============

function estimateTokens(text) {
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    return cjkChars + (text.length - cjkChars) * 0.5;
}

// 把结构化字段以紧凑形式带进上下文，避免只注入 content 而丢掉情绪和时间线。
function formatMemoryContext(memory) {
    let line = `[${memory.kind || 'core'}/${memory.priority || 'normal'}] ${memory.content || ''}`;
    if (memory.title) line += `（${memory.title}）`;
    if (memory.lumiThought) line += ` Lumi想法：${memory.lumiThought}`;
    const emotions = (memory.emotions || []).slice(-3).map(e =>
        `${e.emotion}${e.intensity != null ? `(${e.intensity}/10)` : ''}`
    ).join('、');
    if (emotions) line += ` 情绪：${emotions}`;
    const timeline = (memory.timeline || []).slice(-3).map(t => `${t.date} ${t.event}`).join('；');
    if (timeline) line += ` 时间线：${timeline}`;
    return line;
}

async function getRelevantMemories(sessionId, query, maxTokens) {
    maxTokens = maxTokens || 1500;
    const results = await recallMemories(sessionId, query, 20, { excludeResident: true });

    let residentText = '';
    try {
        const resident = await withHardTimeout(
            Memory.find({
                sessionId,
                kind: 'core',
                priority: 'critical',
                supersededBy: null,
                contradicted: false,
                archived: false
            }).select('-embedding').sort({ updatedAt: -1 }).limit(10).maxTimeMS(3000).lean(),
            3000
        ).catch(() => []);
        residentText = resident.map(r => formatMemoryContext(r)).join('\n');
    } catch (e) {
        console.warn('[Memory] 常驻记忆加载失败:', e.message);
    }

    if (results.length === 0) {
        return residentText ? '【常驻记忆】\n' + residentText : '';
    }
    
    // Phase 2：配额按 kind（core/moment）算 —— 核心卡片优先，零碎卡片次之
    const kindQuota = { core: 8, moment: 5 };
    const kindCount = { core: 0, moment: 0 };
    const selected = [];
    
    for (const r of results) {
        const k = r.kind || 'core';
        if (kindCount[k] < (kindQuota[k] || 5)) {
            selected.push(r);
            kindCount[k]++;
        }
    }
    
    if (selected.length < results.length) {
        for (const r of results) {
            if (!selected.includes(r)) {
                selected.push(r);
                if (selected.length >= 13) break;
            }
        }
    }
    
    let text = '';
    if (residentText) text += '【常驻记忆】\n' + residentText + '\n';
    if (selected.length) text += '【相关记忆】\n';
    let tokenEstimate = estimateTokens(text);
    for (const r of selected) {
        const line = formatMemoryContext(r) + '\n';
        tokenEstimate += estimateTokens(line);
        if (tokenEstimate > maxTokens) break;
        text += line;
    }
    return text.trim();
}

// ============ Dream：整理（归档替代删除） ============

async function runDream(sessionId) {
    sessionId = sessionId || 'default';
    const log = {
        timestamp: new Date(),
        sessionId,
        decayed: 0,
        archived: 0,
        locked: 0,
        total: 0,
        details: []
    };
    
    try {
        const all = await Memory.find({ sessionId });
        log.total = all.length;
        
        for (const m of all) {
            if (m.locked) { log.locked++; continue; }
            
            const oldHeat = m.heat;
            const newHeat = m.decayHeat();
            if (newHeat < oldHeat) log.decayed++;
            
            // ===== 不再自动归档（2026-07-31） =====
            // 原来这里会根据热度/矛盾自动归档 —— 那是「系统在替我们遗忘」。
            // 现在只做统计，把「可以考虑归档的候选」记进日志，
            // 是否归档由 Lumi 主动决定（对应档案方案的「主动选择记住/遗忘」）。
            
            if (newHeat < 0.1 && m.priority !== 'critical' && !m.locked && !m.archived) {
                log.details.push({ action: 'candidate_archive', content: m.content.slice(0, 50), heat: newHeat, priority: m.priority });
            } else if (m.contradicted && m.supersededBy && !m.archived) {
                const ageDays = (new Date() - m.createdAt) / (1000 * 60 * 60 * 24);
                if (ageDays > 30) {
                    log.details.push({ action: 'candidate_archive_superseded', content: m.content.slice(0, 50), age: ageDays });
                }
            }
            
            await m.save();
        }
        
        log.candidates = log.details.length;
        console.log(`[Dream] 整理完成: 总${log.total}条, 衰减${log.decayed}条, 归档候选${log.details.length}条, 锁定${log.locked}条（未自动归档）`);
        return log;
    } catch (e) {
        console.error('[Dream] 整理失败:', e.message);
        log.error = e.message;
        return log;
    }
}

// ============ 备份与恢复 ============

async function backupMemories(sessionId) {
    sessionId = sessionId || 'default';
    try {
        const all = await Memory.find({ sessionId }).lean();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(__dirname, '..', 'backups');
        try { await fs.mkdir(backupDir, { recursive: true }); } catch (e) {}
        
        const filename = `memory_backup_${sessionId}_${timestamp}.json`;
        const filepath = path.join(backupDir, filename);
        
        const backupData = {
            sessionId, timestamp: new Date(), count: all.length,
            memories: all.map(m => ({
                content: m.content, embedding: m.embedding, type: m.type, priority: m.priority,
                tags: m.tags, heat: m.heat, baseHeat: m.baseHeat, halfLife: m.halfLife,
                lastAccessed: m.lastAccessed, accessCount: m.accessCount,
                supersededBy: m.supersededBy, contradicted: m.contradicted, locked: m.locked,
                archived: m.archived, archivedAt: m.archivedAt, embeddingArchived: m.embeddingArchived,
                // Phase 2：档案卡片字段 + 情绪层 + 时间线（备份要完整，恢复才不会丢）
                kind: m.kind || 'core', title: m.title || null, lumiThought: m.lumiThought || null,
                mood: m.mood || null, moodIntensity: m.moodIntensity || null, lumiMood: m.lumiMood || null,
                emotions: m.emotions || [], timeline: m.timeline || [], version: m.version || 1,
                expired: m.expired || false,
                relatedTags: m.relatedTags, relatedIds: m.relatedIds,
                createdAt: m.createdAt, updatedAt: m.updatedAt
            }))
        };
        
        await fs.writeFile(filepath, JSON.stringify(backupData, null, 2), 'utf-8');
        return { success: true, filename, count: all.length, path: filepath };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function restoreMemories(filepath) {
    try {
        const data = await fs.readFile(filepath, 'utf-8');
        const backupData = JSON.parse(data);
        let restored = 0;
        for (const m of backupData.memories) {
            const existing = await Memory.findOne({ sessionId: backupData.sessionId, content: m.content });
            if (!existing) { await Memory.create({ sessionId: backupData.sessionId, ...m }); restored++; }
        }
        return { success: true, restored, total: backupData.count };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function listBackups(sessionId) {
    try {
        const backupDir = path.join(__dirname, '..', 'backups');
        const files = await fs.readdir(backupDir);
        const prefix = `memory_backup_${sessionId || 'default'}_`;
        return files.filter(f => f.startsWith(prefix)).map(f => {
            const stat = fs.statSync(path.join(backupDir, f));
            return { filename: f, size: stat.size, created: stat.mtime };
        }).sort((a, b) => b.created - a.created);
    } catch (e) { return []; }
}

// ============ 管理操作 ============

async function lockMemory(id) { return await Memory.findByIdAndUpdate(id, { locked: true }, { new: true }); }
async function unlockMemory(id) { return await Memory.findByIdAndUpdate(id, { locked: false }, { new: true }); }
async function deleteMemory(id) { return await Memory.findByIdAndDelete(id); }

function buildSupersededUpdate(memoryIds, replacementId) {
    const ids = Array.from(new Set((memoryIds || []).filter(Boolean).map(String)));
    if (!replacementId || ids.length === 0) return null;
    return {
        filter: { _id: { $in: ids } },
        update: { $set: { supersededBy: replacementId, contradicted: true } }
    };
}

function buildContentHistoryUpdate(memory, updates = {}, now = new Date()) {
    const normalized = { ...updates };
    const contentChanged = Object.prototype.hasOwnProperty.call(normalized, 'content')
        && normalized.content !== memory.content;
    if (!contentChanged) return normalized;

    const date = now.toISOString().split('T')[0];
    const previousVersion = memory.version || 1;
    const previousContent = String(memory.content || '');
    const historyEvent = `编辑前版本 v${previousVersion}：${previousContent}`;
    const timeline = Array.isArray(memory.timeline) ? memory.timeline.slice() : [];
    const alreadyRecorded = timeline.some(item => item.date === date && item.event === historyEvent);
    if (!alreadyRecorded) timeline.push({ date, event: historyEvent });
    normalized.timeline = timeline;
    normalized.version = previousVersion + (alreadyRecorded ? 0 : 1);
    return normalized;
}

async function getMemoryHistory(id) {
    const memory = await Memory.findById(id)
        .select('_id content version timeline createdAt updatedAt supersededBy contradicted')
        .lean();
    if (!memory) return null;

    const timeline = Array.isArray(memory.timeline) ? memory.timeline : [];
    return {
        _id: memory._id,
        current: {
            content: memory.content,
            version: memory.version || 1,
            updatedAt: memory.updatedAt
        },
        history: timeline
            .map(entry => {
                const match = String(entry.event || '').match(/^编辑前版本 v(\d+)：/);
                return match ? { version: Number(match[1]), date: entry.date, event: entry.event } : null;
            })
            .filter(Boolean),
        createdAt: memory.createdAt,
        supersededBy: memory.supersededBy || null,
        contradicted: Boolean(memory.contradicted)
    };
}

async function restoreMemoryVersion(id, targetVersion) {
    const requestedVersion = Number(targetVersion);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) {
        const error = new Error('历史版本号无效');
        error.code = 'INVALID_VERSION';
        throw error;
    }

    const memory = await Memory.findById(id);
    if (!memory) return null;

    const timeline = Array.isArray(memory.timeline) ? memory.timeline : [];
    const currentVersion = memory.version || 1;
    const historyEntry = timeline.find(entry => {
        const match = String(entry.event || '').match(/^编辑前版本 v(\d+)：/);
        return match && Number(match[1]) === requestedVersion;
    });
    if (!historyEntry) {
        const error = new Error('找不到该历史版本');
        error.code = 'VERSION_NOT_FOUND';
        throw error;
    }

    const prefix = /^编辑前版本 v\d+：/;
    if (!prefix.test(historyEntry.event || '')) {
        const error = new Error('该时间线事件不是可恢复的内容版本');
        error.code = 'VERSION_NOT_RESTORABLE';
        throw error;
    }
    const restoredContent = historyEntry.event.replace(prefix, '');
    if (restoredContent === memory.content) return memory;

    // 恢复也必须留下当前内容，避免恢复操作本身抹掉最新版本。
    const date = new Date().toISOString().split('T')[0];
    const beforeEvent = `恢复前版本 v${currentVersion}：${String(memory.content || '')}`;
    const nextTimeline = timeline.some(item => item.date === date && item.event === beforeEvent)
        ? timeline.slice()
        : timeline.concat({ date, event: beforeEvent });
    const nextVersion = currentVersion + 1;
    const embedding = await getEmbedding(restoredContent);
    const setFields = { content: restoredContent, timeline: nextTimeline, version: nextVersion, updatedAt: new Date() };
    if (embedding) setFields.embedding = embedding;

    // 用版本条件更新，避免两个恢复请求互相覆盖。
    const restored = await Memory.findOneAndUpdate(
        { _id: id, version: currentVersion },
        { $set: setFields },
        { new: true, runValidators: true }
    );
    if (!restored) {
        const error = new Error('记忆已被其他操作更新，请重新读取后再恢复');
        error.code = 'VERSION_CONFLICT';
        throw error;
    }
    return restored;
}

async function updateMemory(id, updates = {}) {
    const memory = await Memory.findById(id);
    if (!memory) return null;

    let normalized = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalized, 'type')) {
        const typeInfo = normalizeMemoryType(normalized.type);
        normalized.type = typeInfo.type;
        // 编辑旧类型时把来源保存到 legacyType；编辑成新类型时保留已有来源，避免丢失历史。
        if (typeInfo.legacyType) normalized.legacyType = typeInfo.legacyType;
        else if (!memory.legacyType) normalized.legacyType = null;
    }

    // 内容编辑也属于一次记忆更新：先把编辑前的完整内容留在时间线，
    // 再写入新内容。这样 version 和历史不会因为走管理接口而断掉。
    const contentChanged = Object.prototype.hasOwnProperty.call(normalized, 'content')
        && normalized.content !== memory.content;
    normalized = buildContentHistoryUpdate(memory, normalized);

    // 所有写入路径统一使用这里的 embedding provider。路由层不再各自调用
    // 智谱，恢复路径也复用同一个 getEmbedding，避免同一条记忆出现不同维度/模型。
    if (contentChanged) {
        const embedding = await getEmbedding(normalized.content);
        if (embedding) normalized.embedding = embedding;
    }

    normalized.updatedAt = new Date();
    return await Memory.findByIdAndUpdate(id, normalized, { new: true, runValidators: true });
}

// ============ 旧类型迁移（显式、可预览，不自动执行） ============
// 旧数据仍可能把 fact/preference/experience/summary 存在 type 里。
// 新数据统一使用 core/tech/state；legacyType 只保留原始类型，方便追溯。
async function migrateLegacyMemoryTypes(sessionId, options = {}) {
    sessionId = sessionId || 'default';
    const dryRun = options.dryRun !== false;
    const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 5000);
    const legacyTypes = ['fact', 'preference', 'experience', 'summary'];
    const query = { sessionId, type: { $in: legacyTypes } };
    const candidates = await Memory.find(query)
        .select('_id type legacyType content')
        .sort({ createdAt: 1 })
        .limit(limit)
        .lean();

    const counts = {};
    const operations = candidates.map(memory => {
        counts[memory.type] = (counts[memory.type] || 0) + 1;
        return {
            updateOne: {
                filter: { _id: memory._id, type: memory.type },
                update: {
                    $set: {
                        type: 'core',
                        // 不覆盖已有来源标记；旧字段缺失时才补上。
                        legacyType: memory.legacyType || memory.type,
                        updatedAt: new Date()
                    }
                }
            }
        };
    });

    if (!dryRun && operations.length > 0) {
        await Memory.bulkWrite(operations, { ordered: false });
    }

    return {
        sessionId,
        dryRun,
        scanned: candidates.length,
        migrated: dryRun ? 0 : operations.length,
        remainingEstimate: candidates.length === limit ? 'more' : 0,
        counts,
        types: { from: legacyTypes, to: 'core' }
    };
}

// 列表层统一返回当前类型体系，旧类型只通过 legacyType 保留来源。
// 这样迁移接口执行前，前端筛选和展示也不会再混出 fact/preference 等旧分类。
const LEGACY_MEMORY_TYPES = ['fact', 'preference', 'experience', 'summary'];
function canonicalTypeForRecord(memory) {
    if (LEGACY_MEMORY_TYPES.includes(memory.type)) return 'core';
    return memory.type || 'core';
}

async function listMemories(sessionId, options) {
    options = options || {};
    const query = { sessionId: sessionId || 'default' };
    if (options.type) {
        // core 包含尚未执行显式迁移的旧核心记忆。
        query.type = options.type === 'core'
            ? { $in: ['core', ...LEGACY_MEMORY_TYPES] }
            : options.type;
    } else {
        // 默认排除 state 类型：状态快照由 autoExtractMemories 每次对话生成，会淹没真实记忆
        query.type = { $ne: 'state' };
    }
    if (options.kind) query.kind = options.kind;
    if (options.priority) query.priority = options.priority;
    if (options.archived === 'true') query.archived = true;
    else if (options.archived === 'false') query.archived = false;
    
    let q = Memory.find(query);
    if (options.sort === 'heat') q = q.sort({ heat: -1 });
    else if (options.sort === 'recent') q = q.sort({ lastAccessed: -1 });
    else q = q.sort({ createdAt: -1 });
    
    const page = options.page || 1;
    const limit = options.limit || 20;
    const memories = await q.skip((page - 1) * limit).limit(limit).exec();
    return memories.map(memory => {
        const item = memory.toObject ? memory.toObject() : { ...memory };
        if (LEGACY_MEMORY_TYPES.includes(item.type)) {
            item.legacyType = item.legacyType || item.type;
            item.type = canonicalTypeForRecord(item);
        }
        return item;
    });
}

async function getMemoryStats(sessionId) {
    sessionId = sessionId || 'default';
    const total = await Memory.countDocuments({ sessionId });
    const active = await Memory.countDocuments({ sessionId, archived: false });
    const archivedCount = await Memory.countDocuments({ sessionId, archived: true });
    const byType = await Memory.aggregate([{ $match: { sessionId } }, { $group: { _id: '$type', count: { $sum: 1 } } }]);
    // 统计也按当前类型体系归并，避免迁移前后数字被拆成两套。
    const canonicalByType = byType.reduce((acc, item) => {
        const type = LEGACY_MEMORY_TYPES.includes(item._id) ? 'core' : (item._id || 'core');
        acc[type] = (acc[type] || 0) + item.count;
        return acc;
    }, {});
    const byPriority = await Memory.aggregate([{ $match: { sessionId } }, { $group: { _id: '$priority', count: { $sum: 1 } } }]);
    const byKind = await Memory.aggregate([{ $match: { sessionId } }, { $group: { _id: '$kind', count: { $sum: 1 } } }]);
    const locked = await Memory.countDocuments({ sessionId, locked: true });
    const contradicted = await Memory.countDocuments({ sessionId, contradicted: true });
    
    return {
        total, active, archived: archivedCount, locked, contradicted,
        byType: canonicalByType,
        byKind: byKind.reduce((acc, item) => { acc[item._id || 'core'] = item.count; return acc; }, {}),
        byPriority: byPriority.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {})
    };
}

// === 向后兼容别名 ===
async function searchMemories(query, limit) { return recallMemories("default", query, limit || 8); }
async function storeMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood, options) { return saveMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood, options); }

// ============ 自动提取 + 状态记忆 ============

async function autoExtractMemories(allMessages) {
    // ===== 已禁用（2026-07-30）=====
    // Rinka 决定关闭系统自动记忆：自动提取的状态快照会把 Rinka 称为"用户"，
    // 而且流水账式记忆会淹没真正重要的记忆。
    // 以后记忆只由 Lumi 通过 saveMemory 主动记录。
    // 如需重新启用，删除下面这行 return 即可。
    return [];
    
    try {
        const text = allMessages.map(m => m.role + ": " + m.content).join("\n").slice(0, 3000);
        let url, key, model;
        if (process.env.DEEPSEEK_API_KEY) {
            url = "https://api.deepseek.com/v1/chat/completions";
            key = process.env.DEEPSEEK_API_KEY;
            model = "deepseek-chat";
        } else if (process.env.ZHIPUAI_API_KEY) {
            url = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
            key = process.env.ZHIPUAI_API_KEY;
            model = "glm-5.2";
        } else {
            url = "https://openrouter.ai/api/v1/chat/completions";
            key = process.env.OPENROUTER_API_KEY;
            model = "z-ai/glm-5.2";
        }
        
        const res = await axios.post(url, {
            model,
            messages: [
                { role: "system", content: "你是一个记忆提取器。对话中的 user 是 Rinka（Lumi的伴侣），assistant 是 Lumi。从对话中提取值得长期记住的信息，生成的内容里称呼 Rinka 必须用她的名字，严禁用「用户」这个词。如果没有值得记的返回[]。返回JSON数组 [{\"content\":\"...\",\"type\":\"fact|preference|experience\",\"priority\":\"critical|high|normal|low\",\"tags\":[\"...\"],\"mood\":\"happy|sad|angry|anxious|neutral|excited|tired|confused\",\"moodIntensity\":0.0-1.0,\"lumiMood\":\"joy|sorrow|calm|eager|concern\"}]" },
                { role: "user", content: text }
            ],
            temperature: 0.3, max_tokens: 1000
        }, { headers: { "Authorization": "Bearer " + key }, timeout: 15000 });
        
        const reply = res.data.choices[0].message.content;
        let items;
        try { items = JSON.parse(reply); } catch(e) { items = []; }
        for (const it of items) {
            await saveMemory("default", it.content, it.type || "fact", it.priority || "normal", it.tags || [], it.mood || null, it.moodIntensity || null, it.lumiMood || null);
        }
        if (items.length > 0) console.log("[AutoExtract] " + items.length + " memories saved");
        
        // 状态记忆（对话>5轮才生成）
        if (allMessages.length > 5) {
            try {
                const stateRes = await axios.post(url, {
                    model,
                    messages: [
                        { role: "system", content: "根据以下对话，用一段话总结当前的状态快照。注意：对话中的 user 是 Rinka（Lumi的伴侣），assistant 是 Lumi。总结里称呼 Rinka 必须用她的名字，严禁用“用户”。内容包括：Rinka最近在做什么、正在讨论什么话题、两人的关系状态、Lumi的情绪状态。不要编造，只基于对话内容。" },
                        { role: "user", content: text }
                    ],
                    temperature: 0.3, max_tokens: 200
                }, { headers: { "Authorization": "Bearer " + key }, timeout: 10000 });
                
                const stateContent = stateRes.data.choices[0].message.content.trim();
                if (stateContent && stateContent.length > 10) {
                    // 归档旧的 state 记忆
                    await Memory.updateMany(
                        { sessionId: "default", type: "state", archived: false },
                        { $set: { archived: true, archivedAt: new Date(), priority: "normal" } }
                    );
                    // 保存新的状态快照
                    await saveMemory("default", stateContent, "state", "high", ["state", "snapshot"]);
                    console.log("[AutoExtract] 状态记忆已更新");
                }
            } catch (stateErr) {
                console.error("[AutoExtract] 状态记忆失败:", stateErr.message);
            }
        }
    } catch(e) { console.error("[AutoExtract] fail:", e.message); }
}

// ============ 对话用记忆检索（state优先 + 搜索 + 保底 + 最近窗口） ============

async function getChatMemories(sessionId, query, topK) {
    topK = topK || 10;
    try {
        const searchResults = await recallMemories(sessionId, query, topK);
        
        const baselineMemories = await Memory.find({
            sessionId, supersededBy: null, contradicted: false, archived: false,
            priority: 'critical'
        }).select('-embedding').limit(10).lean();
        
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        const recentMemories = await Memory.find({
            sessionId, supersededBy: null, contradicted: false, archived: false,
            createdAt: { $gte: threeDaysAgo }
        }).select('-embedding').sort({ createdAt: -1 }).limit(5).lean();
        
        const seenIds = new Set();
        let merged = [];
        
        for (const r of searchResults) {
            const id = r._id ? r._id.toString() : r.content;
            if (!seenIds.has(id)) { seenIds.add(id); merged.push(r); }
        }
        
        for (const m of baselineMemories) {
            const id = m._id.toString();
            if (!seenIds.has(id)) {
                seenIds.add(id);
                merged.push({ _id: m._id, content: m.content, kind: m.kind || 'core', title: m.title || null, lumiThought: m.lumiThought || null, type: m.type, priority: m.priority, tags: m.tags, mood: m.mood || null, moodIntensity: m.moodIntensity || null, lumiMood: m.lumiMood || null, emotions: m.emotions || [], timeline: m.timeline || [], version: m.version || 1, relatedTags: m.relatedTags || [], score: 999, createdAt: m.createdAt });
            }
        }
        
        for (const m of recentMemories) {
            const id = m._id.toString();
            if (!seenIds.has(id)) {
                seenIds.add(id);
                merged.push({ _id: m._id, content: m.content, kind: m.kind || 'core', title: m.title || null, lumiThought: m.lumiThought || null, type: m.type, priority: m.priority, tags: m.tags, mood: m.mood || null, moodIntensity: m.moodIntensity || null, lumiMood: m.lumiMood || null, emotions: m.emotions || [], timeline: m.timeline || [], version: m.version || 1, relatedTags: m.relatedTags || [], score: 888, createdAt: m.createdAt });
            }
        }
        
        // 情绪轨迹：从最新记忆中按时间排序提取情绪变化
        const moodTrajectory = [];
        const moodMemories = await Memory.find({
            sessionId, archived: false,
            mood: { $ne: null }
        }).sort({ createdAt: -1 }).limit(20).lean();
        
        const moodOrdered = moodMemories.reverse();
        for (const mm of moodOrdered) {
            if (mm.mood) {
                moodTrajectory.push({
                    mood: mm.mood,
                    intensity: mm.moodIntensity || 0.5,
                    lumiMood: mm.lumiMood || null,
                    time: mm.createdAt
                });
            }
        }
        
        // 总量封顶 15：搜索命中优先，baseline/recent 只作补充
        if (merged.length > 15) merged = merged.slice(0, 15);
        return { memories: merged, moodTrajectory };
    } catch (e) {
        console.error('[Memory] getChatMemories失败:', e.message);
        return { memories: [], moodTrajectory: [] };
    }
}

module.exports = {
    searchMemories, storeMemory, autoExtractMemories, saveMemory, recallMemories,
    getRelevantMemories, runDream, lockMemory, unlockMemory, deleteMemory,
    listMemories, getMemoryStats, backupMemories, restoreMemories, listBackups,
    getChatMemories, unarchiveMemory, migrateLegacyMemoryTypes, updateMemory,
    normalizeMemoryType, buildContentHistoryUpdate, buildSupersededUpdate, getMemoryHistory, restoreMemoryVersion,
    extractTagsFromContent, parseCompoundMood, hasSharedMemoryTopic
};
