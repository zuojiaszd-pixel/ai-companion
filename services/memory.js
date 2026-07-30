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

// ============ 存储记忆（带去重逻辑 + 自动提取标签） ============

async function saveMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood) {
    try {
        const embedding = await getEmbedding(content);
        const defaults = Memory.applyPriorityDefaults(priority);
        
        // 自动提取主题标签
        const autoTags = extractTagsFromContent(content);
        const mergedRelatedTags = [...new Set([...autoTags, ...(tags || [])])];
        
        const existing = await Memory.find({ 
            sessionId, 
            supersededBy: null,
            contradicted: false,
            archived: false,
            type: { $in: ['fact', 'preference', 'experience', 'summary'] }
        });
        
        // 去重检测（相似度 > 0.92）
        for (const m of existing) {
            const sim = cosineSim(embedding, m.embedding || []);
            if (sim > 0.92) {
                m.accessCount += 1;
                m.heat = Math.max(m.heat, m.baseHeat) * 1.2;
                m.lastAccessed = new Date();
                if (tags && tags.length > 0) {
                    const existingTags = new Set(m.tags || []);
                    tags.forEach(t => existingTags.add(t));
                    m.tags = Array.from(existingTags);
                }
                // 合并关联标签
                const existingRelated = new Set(m.relatedTags || []);
                mergedRelatedTags.forEach(t => existingRelated.add(t));
                m.relatedTags = Array.from(existingRelated);
                await m.save();
                console.log(`[Memory] 去重命中，已加热: "${content.slice(0, 30)}..." (热度: ${m.heat.toFixed(2)})`);
                return m;
            }
        }
        
        // 矛盾检测（0.85 ~ 0.92）
        let supersededId = null;
        for (const m of existing) {
            const sim = cosineSim(embedding, m.embedding || []);
            if (sim > 0.85 && m.content !== content) {
                m.contradicted = true;
                m.supersededBy = null;
                await m.save();
                supersededId = m._id;
                console.log(`[Memory] 矛盾检测: "${m.content.slice(0, 30)}..." -> "${content.slice(0, 30)}..."`);
            }
        }
        
        const newMemory = await Memory.create({
            sessionId,
            content,
            embedding: embedding || [],
            type: type || 'fact',
            priority: priority || 'normal',
            tags: tags || [],
            mood: mood || null,
            moodIntensity: mood ? (typeof moodIntensity === "number" ? moodIntensity : 0.5) : null,
            lumiMood: lumiMood || null,
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
        
        console.log(`[Memory] 已存储: ${content.slice(0, 50)}... [${type}/${priority}] 标签: [${mergedRelatedTags.join(', ')}]`);
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
                _id: entry.item.memory._id,
                content: entry.item.memory.content,
                type: entry.item.memory.type,
                priority: entry.item.memory.priority,
                tags: entry.item.memory.tags,
                mood: entry.item.memory.mood || null,
                moodIntensity: entry.item.memory.moodIntensity || null,
                lumiMood: entry.item.memory.lumiMood || null,
                score: entry.finalScore,
                createdAt: entry.item.memory.createdAt
            };
        });
        
        await Promise.all(topResults.map(entry => entry.item.memory.save()));
        
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
                    type: m.type,
                    priority: m.priority,
                    tags: m.tags,
                    mood: m.mood || null,
                    moodIntensity: m.moodIntensity || null,
                    lumiMood: m.lumiMood || null,
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
                        type: unarchived.type,
                        priority: unarchived.priority,
                        tags: unarchived.tags,
                        mood: unarchived.mood || null,
                        moodIntensity: unarchived.moodIntensity || null,
                        lumiMood: unarchived.lumiMood || null,
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

async function getRelevantMemories(sessionId, query, maxTokens) {
    maxTokens = maxTokens || 1500;
    const results = await recallMemories(sessionId, query, 20);
    if (results.length === 0) return '';
    
    const typeQuota = { fact: 5, preference: 3, experience: 3, summary: 2, state: 2 };
    const typeCount = { fact: 0, preference: 0, experience: 0, summary: 0, state: 0 };
    const selected = [];
    
    for (const r of results) {
        const t = r.type || 'fact';
        if (typeCount[t] < (typeQuota[t] || 3)) {
            selected.push(r);
            typeCount[t]++;
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
    let tokenEstimate = 0;
    for (const r of selected) {
        const line = `[${r.type}/${r.priority}] ${r.content}\n`;
        tokenEstimate += line.length * 0.5;
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
            
            if (newHeat < 0.1 && m.priority !== 'critical' && !m.locked && !m.archived) {
                m.archived = true;
                m.archivedAt = new Date();
                m.embedding = [];
                m.embeddingArchived = true;
                log.archived++;
                log.details.push({ action: 'archive', content: m.content.slice(0, 50), heat: newHeat, priority: m.priority });
                await m.save();
                continue;
            }
            
            if (m.contradicted && m.supersededBy && !m.archived) {
                const ageDays = (new Date() - m.createdAt) / (1000 * 60 * 60 * 24);
                if (ageDays > 30) {
                    m.archived = true;
                    m.archivedAt = new Date();
                    m.embedding = [];
                    m.embeddingArchived = true;
                    log.archived++;
                    log.details.push({ action: 'archive_superseded', content: m.content.slice(0, 50), age: ageDays });
                    await m.save();
                    continue;
                }
            }
            
            await m.save();
        }
        
        console.log(`[Dream] 整理完成: 总${log.total}条, 衰减${log.decayed}条, 归档${log.archived}条, 锁定${log.locked}条`);
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

async function listMemories(sessionId, options) {
    options = options || {};
    const query = { sessionId: sessionId || 'default' };
    if (options.type) query.type = options.type;
    if (options.priority) query.priority = options.priority;
    if (options.archived === 'true') query.archived = true;
    else if (options.archived === 'false') query.archived = false;
    
    let q = Memory.find(query);
    if (options.sort === 'heat') q = q.sort({ heat: -1 });
    else if (options.sort === 'recent') q = q.sort({ lastAccessed: -1 });
    else q = q.sort({ createdAt: -1 });
    
    const page = options.page || 1;
    const limit = options.limit || 20;
    return await q.skip((page - 1) * limit).limit(limit).exec();
}

async function getMemoryStats(sessionId) {
    sessionId = sessionId || 'default';
    const total = await Memory.countDocuments({ sessionId });
    const active = await Memory.countDocuments({ sessionId, archived: false });
    const archivedCount = await Memory.countDocuments({ sessionId, archived: true });
    const byType = await Memory.aggregate([{ $match: { sessionId } }, { $group: { _id: '$type', count: { $sum: 1 } } }]);
    const byPriority = await Memory.aggregate([{ $match: { sessionId } }, { $group: { _id: '$priority', count: { $sum: 1 } } }]);
    const locked = await Memory.countDocuments({ sessionId, locked: true });
    const contradicted = await Memory.countDocuments({ sessionId, contradicted: true });
    
    return {
        total, active, archived: archivedCount, locked, contradicted,
        byType: byType.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {}),
        byPriority: byPriority.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {})
    };
}

// === 向后兼容别名 ===
async function searchMemories(query, limit) { return recallMemories("default", query, limit || 8); }
async function storeMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood) { return saveMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood); }

// ============ 自动提取 + 状态记忆 ============

async function autoExtractMemories(allMessages) {
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
                { role: "system", content: "你是一个记忆提取器。从对话中提取值得长期记住的信息。如果没有值得记的返回[]。返回JSON数组 [{\"content\":\"...\",\"type\":\"fact|preference|experience\",\"priority\":\"critical|high|normal|low\",\"tags\":[\"...\"],\"mood\":\"happy|sad|angry|anxious|neutral|excited|tired|confused\",\"moodIntensity\":0.0-1.0,\"lumiMood\":\"joy|sorrow|calm|eager|concern\"}]" },
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
                        { role: "system", content: "根据以下对话，用一段话总结当前的状态快照：用户最近在做什么、正在讨论什么话题、关系状态、AI的情绪状态。不要编造，只基于对话内容。" },
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
            priority: { $in: ['critical', 'high'] }
        }).limit(10).lean();
        
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        const recentMemories = await Memory.find({
            sessionId, supersededBy: null, contradicted: false, archived: false,
            createdAt: { $gte: threeDaysAgo }
        }).sort({ createdAt: -1 }).limit(10).lean();
        
        const stateMemories = await Memory.find({
            sessionId, type: 'state', archived: false
        }).sort({ createdAt: -1 }).limit(3).lean();
        
        const seenIds = new Set();
        const merged = [];
        
        for (const m of stateMemories) {
            const id = m._id.toString();
            if (!seenIds.has(id)) {
                seenIds.add(id);
                merged.push({ _id: m._id, content: m.content, type: m.type, priority: m.priority, tags: m.tags, mood: m.mood || null, moodIntensity: m.moodIntensity || null, lumiMood: m.lumiMood || null, score: 1000, createdAt: m.createdAt });
            }
        }
        
        for (const r of searchResults) {
            const id = r._id ? r._id.toString() : r.content;
            if (!seenIds.has(id)) { seenIds.add(id); merged.push(r); }
        }
        
        for (const m of baselineMemories) {
            const id = m._id.toString();
            if (!seenIds.has(id)) {
                seenIds.add(id);
                merged.push({ _id: m._id, content: m.content, type: m.type, priority: m.priority, tags: m.tags, mood: m.mood || null, moodIntensity: m.moodIntensity || null, lumiMood: m.lumiMood || null, score: 999, createdAt: m.createdAt });
            }
        }
        
        for (const m of recentMemories) {
            const id = m._id.toString();
            if (!seenIds.has(id)) {
                seenIds.add(id);
                merged.push({ _id: m._id, content: m.content, type: m.type, priority: m.priority, tags: m.tags, mood: m.mood || null, moodIntensity: m.moodIntensity || null, lumiMood: m.lumiMood || null, score: 888, createdAt: m.createdAt });
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
    getChatMemories, unarchiveMemory
};
