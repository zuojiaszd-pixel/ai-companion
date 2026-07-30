const axios = require('axios');
const Memory = require('../models/Memory');
const fs = require('fs').promises;
const path = require('path');

// ============ 基础工具函数 ============

async function getEmbedding(text) {
    const res = await axios.post('https://openrouter.ai/api/v1/embeddings', {
        model: 'text-embedding-3-small',
        input: text
    }, {
        headers: {
            'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
            'Content-Type': 'application/json'
        }
    });
    return res.data.data[0].embedding;
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
    return text.toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0);
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
    }).limit(100).lean();
    
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
    }).limit(8).lean();
    
    return related;
}

// ============ 存储记忆（带去重逻辑 + 自动提取标签 + 情绪感知） ============

async function saveMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood) {
    try {
        // 情绪是必要条件：core 类型必须带情绪
        if (type === 'core' && !mood) {
            mood = 'neutral';
            moodIntensity = 0.5;
            console.log(`[Memory] 核心记忆默认情绪: neutral`);
        }
        
        const embedding = await getEmbedding(content);
        const defaults = Memory.applyPriorityDefaults(priority);
        
        // 自动提取主题标签
        const autoTags = extractTagsFromContent(content);
        const mergedRelatedTags = [...new Set([...autoTags, ...(tags || [])])];
        
        // 只查活跃区的新类型记忆（兼容旧类型，但新记忆只用新类型）
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
            if (sim > 0.78) {
                m.accessCount += 1;
                m.lastAccessed = new Date();
                m.heat = Math.max(m.heat, m.baseHeat) * 1.2;
                
                // 智能融合：内容不完全相同且有新信息时合并
                if (content !== m.content) {
                    const newTokens = new Set(tokenize(content));
                    const existingTokens = new Set(tokenize(m.content));
                    const extraTokens = [...newTokens].filter(t => !existingTokens.has(t));
                    const extraRatio = extraTokens.length / Math.max(newTokens.size, 1);
                    
                    if (extraRatio > 0.1 && (m.content.length + content.length < 500)) {
                        // 融合前记录时间线事件
                        const now = new Date();
                        const dateStr = now.toISOString().split('T')[0];
                        const eventDesc = content.length > 30 ? content.slice(0, 30) + '…' : content;
                        m.addTimelineEvent(dateStr, eventDesc);
                        
                        m.content = m.content + ' | ' + content;
                        
                        // 融合后重新生成 embedding（确保检索准确）
                        try {
                            m.embedding = await getEmbedding(m.content);
                        } catch (embErr) {
                            console.error('[Memory] 融合后 embedding 生成失败:', embErr.message);
                        }
                        
                        console.log(`[Memory] 融合: ${extraTokens.length}个信息点, 新版本 v${m.version}`);
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
                
                if (tags && tags.length > 0) {
                    const existingTags = new Set(m.tags || []);
                    tags.forEach(t => existingTags.add(t));
                    m.tags = Array.from(existingTags);
                }
                const existingRelated = new Set(m.relatedTags || []);
                mergedRelatedTags.forEach(t => existingRelated.add(t));
                m.relatedTags = Array.from(existingRelated);
                
                await m.save();
                console.log(`[Memory] 融合完成: "${content.slice(0, 30)}..." (热度: ${m.heat.toFixed(2)}, v${m.version})`);
                return m;
            }
        }
        
        // ====== 矛盾检测（0.70 ~ 0.78） ======
        let supersededId = null;
        for (const m of existing) {
            const sim = cosineSim(embedding, m.embedding || []);
            if (sim > 0.70 && m.content !== content) {
                m.contradicted = true;
                m.supersededBy = null;
                await m.save();
                supersededId = m._id;
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
            // 新类型体系：默认 tech（技术流水账），core 需要主动指定
            type: type || 'tech',
            priority: priority || 'normal',
            tags: tags || [],
            mood: mood ? moodParts[0] || mood : null,
            moodIntensity: mood ? (typeof moodIntensity === "number" ? moodIntensity : 0.5) : null,
            lumiMood: lumiMood || null,
            // 结构化情绪记录
            emotions: emotions.length > 0 ? emotions : [],
            // TTL：tech 类型默认 7 天
            ttl: (type === 'tech' && !ttl) ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : (type === 'tech' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null),
            heat: defaults.baseHeat,
            baseHeat: defaults.baseHeat,
            halfLife: defaults.halfLife,
            lastAccessed: new Date(),
            accessCount: 0,
            locked: false,
            archived: false,
            relatedTags: mergedRelatedTags
        });
        
        if (supersededId) {
            await Memory.findByIdAndUpdate(supersededId, { supersededBy: newMemory._id });
        }
        
        console.log(`[Memory] 已存储: ${content.slice(0, 50)}... [${type || 'tech'}/${priority}] 情绪: ${mood || '无'} 标签: [${mergedRelatedTags.join(', ')}]`);
        return newMemory;
    } catch (e) {
        console.error('[Memory] 存储失败:', e.message);
        return null;
    }
}

// ============ 检索记忆（多Query + RRF + 归档补充 + 关联联想） ============

async function recallMemories(sessionId, query, topK) {
    topK = topK || 10;
    try {
        const multiQueries = generateMultiQueries(query);
        const embeddings = await Promise.all(multiQueries.map(q => getEmbedding(q).catch(() => null)));
        
        const all = await Memory.find({ 
            sessionId, 
            supersededBy: null,
            contradicted: false,
            archived: false
        }).sort({ createdAt: -1 }).limit(100);
        
        if (all.length === 0) return [];
        
        const rrfK = 60;
        const rrfScores = new Map();
        
        for (let qi = 0; qi < multiQueries.length; qi++) {
            const queryEmbedding = embeddings[qi];
            const queryTokens = tokenize(multiQueries[qi]);
            if (!queryEmbedding) continue;
            
            const vectorRanked = all.map(m => ({
                memory: m,
                vectorScore: cosineSim(queryEmbedding, m.embedding || []),
                keywordScore: 0
            }));
            vectorRanked.sort((a, b) => b.vectorScore - a.vectorScore);
            
            for (const item of vectorRanked) {
                const contentTokens = tokenize(item.memory.content + ' ' + (item.memory.tags || []).join(' '));
                const matchCount = queryTokens.filter(t => contentTokens.includes(t)).length;
                item.keywordScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
            }
            const keywordRanked = [...vectorRanked].sort((a, b) => b.keywordScore - a.keywordScore);
            
            vectorRanked.forEach((item, rank) => {
                const id = item.memory._id.toString();
                const score = rrfScores.get(id) || { item, score: 0 };
                score.score += 1 / (rrfK + rank + 1);
                rrfScores.set(id, score);
            });
            
            keywordRanked.forEach((item, rank) => {
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
            const heat = m.decayHeat ? m.decayHeat() : 1.0;
            const priorityBoost = { critical: 0.3, high: 0.15, normal: 0, low: -0.1 }[m.priority] || 0;
            const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
            const recentBonus = ageDays <= RECENT_WINDOW_DAYS ? RECENT_BONUS * (1 - ageDays / RECENT_WINDOW_DAYS) : 0;
            entry.finalScore = entry.score + heat * 0.05 + priorityBoost + recentBonus;
            return entry;
        });
        
        ranked.sort((a, b) => b.finalScore - a.finalScore);
        
        const topResults = ranked.slice(0, topK);
        
        const results = topResults.map(entry => {
            entry.item.memory.touch();
            return {
                _id: entry.item.memory