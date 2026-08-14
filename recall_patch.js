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

        // ===== 修复1：候选查询排除 embedding（超时根因） =====
        // 每条记忆的 embedding 约 6KB，76 条全字段从 Atlas 远程拉回要十几秒。
        // 排序和关键词粗筛用不到 embedding，先快速拿到候选集。
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

        // ===== 修复2：关键词粗筛，缩小需要 embedding 的 pool（top 40） =====
        const allTokens = [...new Set(multiQueries.flatMap(q => tokenize(q)))];
        let pool = candidates;
        if (allTokens.length > 0) {
            const kwScored = candidates.map(c => {
                const contentTokens = tokenize(c.content + ' ' + (c.tags || []).join(' '));
                const matchCount = allTokens.filter(t => contentTokens.includes(t)).length;
                return { c, kw: matchCount / allTokens.length };
            });
            kwScored.sort((a, b) => b.kw - a.kw);
            pool = kwScored.slice(0, 40).map(x => x.c);
        } else {
            pool = candidates.slice(0, 40);
        }

        // ===== 修复3：只给 pool 按需加载 embedding（只取 _id + embedding） =====
        let embMap = new Map();
        try {
            const embDocs = await Memory.find({ _id: { $in: pool.map(c => c._id) } })
                .select('_id embedding')
                .maxTimeMS(3000)
                .lean();
            embMap = new Map(embDocs.map(d => [d._id.toString(), d.embedding || []]));
        } catch (e) {
            console.warn('[Memory] embedding 按需加载失败，走纯关键词兜底:', e.message);
        }

        const rrfK = 60;
        const rrfScores = new Map();

        for (let qi = 0; qi < multiQueries.length; qi++) {
            const queryEmbedding = embeddings[qi];
            const queryTokens = tokenize(multiQueries[qi]);

            // A. 关键词 RRF（全量 candidates，保证召回，不依赖 embedding）
            if (queryTokens.length > 0) {
                const kwRanked = candidates.map(m => {
                    const contentTokens = tokenize(m.content + ' ' + (m.tags || []).join(' '));
                    const matchCount = queryTokens.filter(t => contentTokens.includes(t)).length;
                    return { memory: m, kw: queryTokens.length > 0 ? matchCount / queryTokens.length : 0 };
                });
                kwRanked.sort((a, b) => b.kw - a.kw);
                kwRanked.forEach((item, rank) => {
                    const id = item.memory._id.toString();
                    const score = rrfScores.get(id) || { item, score: 0 };
                    score.score += 1 / (rrfK + rank + 1);
                    rrfScores.set(id, score);
                });
            }

            // B. 向量 RRF（只对 pool 成员，用按需加载的 embedding）
            if (queryEmbedding && embMap.size > 0) {
                const vecRanked = pool.map(m => ({
                    memory: m,
                    vectorScore: cosineSim(queryEmbedding, embMap.get(m._id.toString()) || [])
                }));
                vecRanked.sort((a, b) => b.vectorScore - a.vectorScore);
                vecRanked.forEach((item, rank) => {
                    const id = item.memory._id.toString();
                    const score = rrfScores.get(id) || { item, score: 0 };
                    score.score += 1 / (rrfK + rank + 1);
                    rrfScores.set(id, score);
                });
            }
        }

        const RECENT_WINDOW_DAYS = 7;
        const RECENT_BONUS = 0.08;
        const now = new Date();

        const ranked = Array.from(rrfScores.values()).map(entry => {
            const m = entry.item.memory;
            // lean 对象没有 decayHeat() 方法，手动按相同公式计算
            let heat;
            if (m.locked) {
                heat = m.heat;
            } else {
                const last = m.lastAccessed || m.createdAt || now;
                const daysSinceAccess = (now - last) / (1000 * 60 * 60 * 24);
                heat = daysSinceAccess > 0
                    ? m.baseHeat * Math.pow(0.5, daysSinceAccess / m.halfLife)
                    : m.heat;
            }
            const priorityBoost = { critical: 0.3, high: 0.15, normal: 0, low: -0.1 }[m.priority] || 0;
            const ageDays = (now - m.createdAt) / (1000 * 60 * 60 * 24);
            const recentBonus = ageDays <= RECENT_WINDOW_DAYS ? RECENT_BONUS * (1 - ageDays / RECENT_WINDOW_DAYS) : 0;
            entry.finalScore = entry.score + heat * 0.05 + priorityBoost + recentBonus;
            return entry;
        });

        ranked.sort((a, b) => b.finalScore - a.finalScore);

        const topResults = ranked.slice(0, topK);

        const results = topResults.map(entry => {
            const m = entry.item.memory;
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
                score: entry.finalScore,
                createdAt: m.createdAt
            };
        });

        // ===== 修复4：touch 用原子 updateOne（pipeline 更新） =====
        // 不重新加载完整文档，避免 mongoose 对未加载 embedding 的文档 save() 造成字段损坏或超时
        await Promise.all(topResults.map(entry =>
            Memory.updateOne(
                { _id: entry.item.memory._id },
                [
                    { $set: {
                        accessCount: { $add: ['$accessCount', 1] },
                        lastAccessed: new Date(),
                        heat: { $max: ['$heat', '$baseHeat'] },
                        updatedAt: new Date()
                    } }
                ]
            ).catch(() => {})
        ));

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

