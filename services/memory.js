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

// 简单关键词分词
function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0);
}

// ============ 多Query生成 ============

function generateMultiQueries(query) {
    const queries = [query]; // 原始query
    
    // query 2: 关键词组合
    const tokens = tokenize(query);
    if (tokens.length > 1) {
        // 取前5个关键词重新组合
        const topTokens = tokens.slice(0, 5);
        queries.push(topTokens.join(' '));
    }
    
    // query 3: 去掉停用词后的query
    const stopwords = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '和', '与', '或', '也', '都', '就', '不', '没', '有', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for']);
    const filtered = tokens.filter(t => !stopwords.has(t));
    if (filtered.length > 0 && filtered.length < tokens.length) {
        queries.push(filtered.join(' '));
    }
    
    // query 4: 如果query是问句，提取核心实体
    if (query.includes('？') || query.includes('?')) {
        // 去掉疑问词
        const questionWords = ['什么', '怎么', '为什么', '哪', '谁', '多少', '是不是', '有没有', 'what', 'how', 'why', 'where', 'who', 'when'];
        let coreQuery = query;
        for (const qw of questionWords) {
            coreQuery = coreQuery.replace(new RegExp(qw, 'gi'), '');
        }
        coreQuery = coreQuery.replace(/[？?！!]/g, '').trim();
        if (coreQuery.length > 0 && coreQuery !== query) {
            queries.push(coreQuery);
        }
    }
    
    return queries;
}

// ============ 存储记忆 ============

async function saveMemory(sessionId, content, type, priority, tags) {
    try {
        const embedding = await getEmbedding(content);
        const defaults = Memory.applyPriorityDefaults(priority);
        
        // 矛盾检测：查找与新记忆高度相似的旧记忆
        const existing = await Memory.find({ 
            sessionId, 
            supersededBy: null,
            contradicted: false,
            type: { $in: ['fact', 'preference'] }
        });
        
        let supersededId = null;
        for (const m of existing) {
            const sim = cosineSim(embedding, m.embedding || []);
            if (sim > 0.85 && m.content !== content) {
                // 标记旧记忆为被取代
                m.contradicted = true;
                m.supersededBy = null; // 先存null，创建后更新
                await m.save();
                supersededId = m._id;
                console.log(`[Memory] 检测到矛盾，旧记忆被标记: "${m.content.slice(0, 30)}..." -> "${content.slice(0, 30)}..."`);
            }
        }
        
        const newMemory = await Memory.create({
            sessionId,
            content,
            embedding: embedding || [],
            type: type || 'fact',
            priority: priority || 'normal',
            tags: tags || [],
            heat: defaults.baseHeat,
            baseHeat: defaults.baseHeat,
            halfLife: defaults.halfLife,
            lastAccessed: new Date(),
            accessCount: 0,
            locked: false
        });
        
        // 更新被取代记忆的supersededBy
        if (supersededId) {
            await Memory.findByIdAndUpdate(supersededId, { supersededBy: newMemory._id });
        }
        
        console.log(`[Memory] 记忆已存储: ${content.slice(0, 50)}... [${type}/${priority}]`);
        return newMemory;
    } catch (e) {
        console.error('[Memory] 存储失败:', e.message);
        return null;
    }
}

// ============ 检索记忆（多Query并行 + RRF混合检索） ============

async function recallMemories(sessionId, query, topK) {
    topK = topK || 10;
    try {
        // 生成多个query变体
        const multiQueries = generateMultiQueries(query);
        console.log(`[Memory] 多Query搜索: ${multiQueries.length}个变体`);
        
        // 并行获取所有query的embedding
        const embeddings = await Promise.all(multiQueries.map(q => getEmbedding(q).catch(() => null)));
        
        // 获取所有未被取代的记忆
        const all = await Memory.find({ 
            sessionId, 
            supersededBy: null,
            contradicted: false
        }).sort({ createdAt: -1 }).limit(200);
        
        if (all.length === 0) return [];
        
        const rrfK = 60; // RRF常数
        const rrfScores = new Map();
        
        // 对每个query分别做向量检索和关键词检索，然后用RRF融合
        for (let qi = 0; qi < multiQueries.length; qi++) {
            const queryEmbedding = embeddings[qi];
            const queryTokens = tokenize(multiQueries[qi]);
            if (!queryEmbedding) continue;
            
            // 向量检索排名
            const vectorRanked = all.map(m => ({
                memory: m,
                vectorScore: cosineSim(queryEmbedding, m.embedding || []),
                keywordScore: 0
            }));
            vectorRanked.sort((a, b) => b.vectorScore - a.vectorScore);
            
            // 关键词检索排名
            for (const item of vectorRanked) {
                const contentTokens = tokenize(item.memory.content + ' ' + (item.memory.tags || []).join(' '));
                const matchCount = queryTokens.filter(t => contentTokens.includes(t)).length;
                item.keywordScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
            }
            const keywordRanked = [...vectorRanked].sort((a, b) => b.keywordScore - a.keywordScore);
            
            // RRF融合：每个query的向量排名和关键词排名都贡献分数
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
        
        // 热度加权 + 优先级加权 + 最近记忆窗口加分
        const RECENT_WINDOW_DAYS = 7;
        const RECENT_BONUS = 0.08;
        const now = new Date();
        
        const ranked = Array.from(rrfScores.values()).map(entry => {
            const m = entry.item.memory;
            const heat = m.decayHeat ? m.decayHeat() : 1.0;
            const priorityBoost = { critical: 0.3, high: 0.15, normal: 0, low: -0.1 }[m.priority] || 0;
            
            // 最近记忆窗口：7天内创建的记忆额外加分
            const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
            const recentBonus = ageDays <= RECENT_WINDOW_DAYS ? RECENT_BONUS * (1 - ageDays / RECENT_WINDOW_DAYS) : 0;
            
            entry.finalScore = entry.score + heat * 0.05 + priorityBoost + recentBonus;
            return entry;
        });
        
        ranked.sort((a, b) => b.finalScore - a.finalScore);
        
        const results = ranked.slice(0, topK).map(entry => {
            // touch：回弹热度
            entry.item.memory.touch();
            
            return {
                content: entry.item.memory.content,
                type: entry.item.memory.type,
                priority: entry.item.memory.priority,
                tags: entry.item.memory.tags,
                score: entry.finalScore,
                createdAt: entry.item.memory.createdAt
            };
        });
        
        // 批量保存touch后的状态
        await Promise.all(ranked.slice(0, topK).map(entry => entry.item.memory.save()));
        
        console.log(`[Memory] 检索完成: query="${query.slice(0, 30)}...", ${multiQueries.length}个query变体, 返回${results.length}条`);
        return results;
    } catch (e) {
        console.error('[Memory] 检索失败:', e.message);
        return [];
    }
}

// ============ 分层注入（给system prompt用） ============

async function getRelevantMemories(sessionId, query, maxTokens) {
    maxTokens = maxTokens || 1500;
    const results = await recallMemories(sessionId, query, 20);
    
    if (results.length === 0) return '';
    
    // 分层：按type分配名额
    const typeQuota = { fact: 5, preference: 3, experience: 3, summary: 2 };
    const typeCount = { fact: 0, preference: 0, experience: 0, summary: 0 };
    const selected = [];
    
    for (const r of results) {
        const t = r.type || 'fact';
        if (typeCount[t] < typeQuota[t]) {
            selected.push(r);
            typeCount[t]++;
        }
    }
    
    // 如果名额没用完，补充剩余
    if (selected.length < results.length) {
        for (const r of results) {
            if (!selected.includes(r)) {
                selected.push(r);
                if (selected.length >= 13) break;
            }
        }
    }
    
    // 格式化为文本，控制token
    let text = '';
    let tokenEstimate = 0;
    for (const r of selected) {
        const line = `[${r.type}/${r.priority}] ${r.content}\n`;
        tokenEstimate += line.length * 0.5; // 粗估token
        if (tokenEstimate > maxTokens) break;
        text += line;
    }
    
    return text.trim();
}

// ============ Dream：记忆整理 ============

async function runDream(sessionId) {
    sessionId = sessionId || 'default';
    const log = {
        timestamp: new Date(),
        sessionId,
        decayed: 0,
        cleaned: 0,
        locked: 0,
        total: 0,
        details: []
    };
    
    try {
        const all = await Memory.find({ sessionId });
        log.total = all.length;
        
        for (const m of all) {
            if (m.locked) {
                log.locked++;
                continue;
            }
            
            // 衰减热度
            const oldHeat = m.heat;
            const newHeat = m.decayHeat();
            if (newHeat < oldHeat) {
                log.decayed++;
            }
            
            // 清理：热度低于阈值且不是critical（critical保底）
            const CLEAN_THRESHOLD = 0.05;
            if (newHeat < CLEAN_THRESHOLD && m.priority !== 'critical' && !m.locked) {
                log.cleaned++;
                log.details.push({
                    action: 'delete',
                    content: m.content.slice(0, 50),
                    heat: newHeat,
                    priority: m.priority
                });
                await Memory.findByIdAndDelete(m._id);
                continue;
            }
            
            // 清理被取代的记忆（保留一段时间后删除）
            if (m.contradicted && m.supersededBy) {
                const ageDays = (new Date() - m.createdAt) / (1000 * 60 * 60 * 24);
                if (ageDays > 30) {
                    log.cleaned++;
                    log.details.push({
                        action: 'delete_superseded',
                        content: m.content.slice(0, 50),
                        age: ageDays
                    });
                    await Memory.findByIdAndDelete(m._id);
                    continue;
                }
            }
            
            await m.save();
        }
        
        console.log(`[Dream] 整理完成: 总${log.total}条, 衰减${log.decayed}条, 清理${log.cleaned}条, 锁定${log.locked}条`);
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
        
        // 确保备份目录存在
        try {
            await fs.mkdir(backupDir, { recursive: true });
        } catch (e) {
            // 目录已存在则忽略
        }
        
        const filename = `memory_backup_${sessionId}_${timestamp}.json`;
        const filepath = path.join(backupDir, filename);
        
        const backupData = {
            sessionId,
            timestamp: new Date(),
            count: all.length,
            memories: all.map(m => ({
                content: m.content,
                embedding: m.embedding,
                type: m.type,
                priority: m.priority,
                tags: m.tags,
                heat: m.heat,
                baseHeat: m.baseHeat,
                halfLife: m.halfLife,
                lastAccessed: m.lastAccessed,
                accessCount: m.accessCount,
                supersededBy: m.supersededBy,
                contradicted: m.contradicted,
                locked: m.locked,
                createdAt: m.createdAt,
                updatedAt: m.updatedAt
            }))
        };
        
        await fs.writeFile(filepath, JSON.stringify(backupData, null, 2), 'utf-8');
        console.log(`[Backup] 备份完成: ${all.length}条记忆 -> ${filename}`);
        return { success: true, filename, count: all.length, path: filepath };
    } catch (e) {
        console.error('[Backup] 备份失败:', e.message);
        return { success: false, error: e.message };
    }
}

async function restoreMemories(filepath) {
    try {
        const data = await fs.readFile(filepath, 'utf-8');
        const backupData = JSON.parse(data);
        
        let restored = 0;
        for (const m of backupData.memories) {
            // 检查是否已存在（按content去重）
            const existing = await Memory.findOne({ 
                sessionId: backupData.sessionId, 
                content: m.content 
            });
            if (!existing) {
                await Memory.create({
                    sessionId: backupData.sessionId,
                    ...m
                });
                restored++;
            }
        }
        
        console.log(`[Restore] 恢复完成: ${restored}/${backupData.count}条记忆`);
        return { success: true, restored, total: backupData.count };
    } catch (e) {
        console.error('[Restore] 恢复失败:', e.message);
        return { success: false, error: e.message };
    }
}

async function listBackups(sessionId) {
    try {
        const backupDir = path.join(__dirname, '..', 'backups');
        const files = await fs.readdir(backupDir);
        const prefix = `memory_backup_${sessionId || 'default'}_`;
        const backups = files.filter(f => f.startsWith(prefix)).map(f => {
            const stat = fs.statSync(path.join(backupDir, f));
            return { filename: f, size: stat.size, created: stat.mtime };
        }).sort((a, b) => b.created - a.created);
        return backups;
    } catch (e) {
        return [];
    }
}

// ============ 管理操作 ============

async function lockMemory(id) {
    return await Memory.findByIdAndUpdate(id, { locked: true }, { new: true });
}

async function unlockMemory(id) {
    return await Memory.findByIdAndUpdate(id, { locked: false }, { new: true });
}

async function deleteMemory(id) {
    return await Memory.findByIdAndDelete(id);
}

async function listMemories(sessionId, options) {
    options = options || {};
    const query = { sessionId: sessionId || 'default' };
    
    if (options.type) query.type = options.type;
    if (options.priority) query.priority = options.priority;
    
    let q = Memory.find(query);
    
    // 排序
    if (options.sort === 'heat') {
        q = q.sort({ heat: -1 });
    } else if (options.sort === 'recent') {
        q = q.sort({ lastAccessed: -1 });
    } else {
        q = q.sort({ createdAt: -1 });
    }
    
    // 分页
    const page = options.page || 1;
    const limit = options.limit || 20;
    q = q.skip((page - 1) * limit).limit(limit);
    
    return await q.exec();
}

async function getMemoryStats(sessionId) {
    sessionId = sessionId || 'default';
    const total = await Memory.countDocuments({ sessionId });
    const byType = await Memory.aggregate([
        { $match: { sessionId } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);
    const byPriority = await Memory.aggregate([
        { $match: { sessionId } },
        { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);
    const locked = await Memory.countDocuments({ sessionId, locked: true });
    const contradicted = await Memory.countDocuments({ sessionId, contradicted: true });
    
    return {
        total,
        locked,
        contradicted,
        byType: byType.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {}),
        byPriority: byPriority.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {})
    };
}

// === 向后兼容别名（旧代码调用 searchMemories / storeMemory） ===
async function searchMemories(query, limit) {
    return recallMemories("default", query, limit || 8);
}
async function storeMemory(sessionId, content, type, priority, tags) {
    return saveMemory(sessionId, content, type, priority, tags);
}
async function autoExtractMemories(allMessages) {
    try {
        const text = allMessages.map(function(m) { return m.role + ": " + m.content; }).join("\n").slice(0, 3000);
        const axios = require("axios");
        const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "z-ai/glm-5.2",
            messages: [
                { role: "system", content: "你是一个记忆提取器。从对话中提取值得长期记住的信息。如果没有值得记的返回[]。返回JSON数组 [{\"content\":\"...\",\"type\":\"fact|preference|experience\",\"priority\":\"critical|high|normal|low\",\"tags\":[\"...\"]}]" },
                { role: "user", content: text }
            ],
            temperature: 0.3,
            max_tokens: 1000
        }, {
            headers: { "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY },
            timeout: 15000
        });
        const reply = res.data.choices[0].message.content;
        var items;
        try { items = JSON.parse(reply); } catch(e) { items = []; }
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            await saveMemory("default", it.content, it.type || "fact", it.priority || "normal", it.tags || []);
        }
        if (items.length > 0) console.log("[AutoExtract] " + items.length + " memories saved");
    } catch(e) { console.error("[AutoExtract] fail:", e.message); }
}

module.exports = {
    searchMemories,
    storeMemory,
    autoExtractMemories,
    saveMemory,
    recallMemories,
    getRelevantMemories,
    runDream,
    lockMemory,
    unlockMemory,
    deleteMemory,
    listMemories,
    getMemoryStats,
    backupMemories,
    restoreMemories,
    listBackups
};
