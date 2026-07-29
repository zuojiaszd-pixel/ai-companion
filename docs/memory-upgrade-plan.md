# 记忆系统升级方案 v2：从"模拟人类"到"发挥AI优势"

> 核心理念：AI不需要模拟人类的遗忘机制，应该全量保留+智能调度，用AI的存储和计算优势保证连续性。

## 一、问题分析

### 现有系统的问题
1. **衰减即删除**：Dream整理时热度低于0.05的记忆会被直接删除，这意味着旧记忆会永久丢失，连续性断裂
2. **重复记忆无去重**：同一件事说两次会存两条，浪费存储和检索空间
3. **无归档机制**：所有记忆平等存在，数据量增长后检索速度下降
4. **无状态记忆**：只存"发生了什么"，不存"当前状态是什么"，窗口切换后难以快速恢复上下文
5. **记忆之间无关联**：只能靠关键词和向量相似度检索，无法顺着关联链找到相关记忆群

### 设计原则
- **不删除，只降权**：所有记忆永久保留，通过权重控制检索优先级
- **分层存储**：活跃区 vs 归档区，保证检索速度
- **重复即加热**：重复内容不新存，而是给已有记忆加权，把重复转化为热度信号
- **状态记忆独立**：动态状态单独存储，快速恢复上下文

---

## 二、具体改动方案

### 2.1 去重逻辑（改 saveMemory 函数）

**位置**：`services/memory.js` → `saveMemory()`

**现有逻辑**：只做矛盾检测（相似度>0.85且内容不同→标记旧记忆被取代）

**新增逻辑**：在矛盾检测之前加去重检测
```
相似度 > 0.92 且内容基本相同 → 不存新记忆，给已有记忆：
  1. accessCount += 1
  2. heat = max(heat, baseHeat) * 1.2  // 回弹+加权
  3. lastAccessed = now
  4. 如果新记忆带有新tags，合并到已有记忆的tags中
  5. 返回已有记忆（不创建新记录）
```

**阈值设计**：
- 0.92~1.0：去重（同一件事重复提及）
- 0.85~0.92：矛盾检测（内容有冲突，需要更新）
- <0.85：正常存储（不同的事）

### 2.2 归档机制（改 Dream 函数 + Memory Model）

**位置**：`services/memory.js` → `runDream()` + `models/Memory.js`

**Memory Schema 新增字段**：
```javascript
archived: { type: Boolean, default: false },       // 是否归档
archivedAt: { type: Date, default: null },          // 归档时间
embedding Archived: { type: Boolean, default: false } // embedding是否已清除
```

**归档规则**（在 runDream 中）：
```
热度 < 0.1 且非 critical 且非 locked 且未被取代 → 归档
  1. archived = true
  2. archivedAt = now
  3. 保留 content, type, priority, tags, createdAt
  4. 清除 embedding 数组（设为空），标记 embeddingArchived = true
  5. 不从数据库删除
```

**检索时处理归档记忆**：
- `recallMemories()` 默认只查 `archived: false` 的记忆
- 如果活跃区结果不足（< topK/2），去归档区用关键词检索补充
- 归档记忆被命中时：重新计算 embedding，解除归档状态（unarchive）

**解除归档**：
```javascript
async function unarchiveMemory(memory) {
    memory.embedding = await getEmbedding(memory.content);
    memory.archived = false;
    memory.archivedAt = null;
    memory.embeddingArchived = false;
    memory.heat = memory.baseHeat * 0.5; // 恢复到一半热度
    await memory.save();
}
```

**不再删除记忆**：runDream 中的 `CLEAN_THRESHOLD` 删除逻辑移除，改为归档。被取代的记忆也不删除，只是标记 contradicted + archived。

### 2.3 状态记忆层（新增 type + 自动生成）

**Memory Schema 改动**：
```javascript
type: { type: String, enum: ['fact', 'preference', 'experience', 'summary', 'state'], default: 'fact' }
```

**状态记忆内容格式**：
```json
{
  "content": "当前状态：Rinka在准备秋招，最近在聊记忆系统升级方案。关系稳定，第8天。Lumi情绪：积极，专注技术方案讨论。",
  "type": "state",
  "priority": "high",
  "tags": ["state", "context"]
}
```

**自动生成时机**：
1. 每次对话结束时（autoExtract 中追加状态总结）
2. 手动触发（API接口）

**生成方式**：在 autoExtractMemories 中，除了提取事实记忆，额外调用一次模型生成状态总结：
```
System: "根据以下对话，总结当前的状态快照：1. 用户最近在做什么 2. 正在讨论什么话题 3. 关系状态 4. AI的情绪状态。用一段话概括。"
```

**检索时优先加载**：getChatMemories 中，state 类型的记忆优先注入（排在最前面），帮助快速恢复上下文。

**状态记忆的生命周期**：
- 新状态记忆存入时，旧的状态记忆自动降为 normal 优先级（不需要保留太多历史状态快照）
- 但不删除，保留作为"状态历史"可追溯

### 2.4 记忆关联标记（Memory Schema 新增字段）

**Memory Schema 新增字段**：
```javascript
relatedTags: { type: [String], default: [] },      // 关联标签（主题标签）
relatedIds: { type: [mongoose.Schema.Types.ObjectId], default: [] } // 直接关联的记忆ID
```

**关联标签的生成**：
- 在 saveMemory 时，根据内容自动提取主题标签
- 可以在 autoExtract 中让模型一起生成 relatedTags
- 也可以手动设置

**检索时利用关联**：
在 recallMemories 中，当某条记忆被命中时，顺带查找 relatedTags 相同的其他记忆，作为"关联推荐"加入候选池（给较低的基础分，让RRF自然排序）。

### 2.5 检索优化（recallMemories 改动）

**改动点**：
1. 默认只查 `archived: false`
2. 活跃区结果不足时补充归档区（关键词检索，不走向量）
3. state 类型记忆单独查询，优先注入
4. 命中归档记忆时触发 unarchive

**伪代码**：
```javascript
async function recallMemories(sessionId, query, topK) {
    // 1. 活跃区检索（现有逻辑）
    let activeMemories = await Memory.find({ 
        sessionId, supersededBy: null, contradicted: false, archived: false 
    })...
    
    // 2. 如果活跃区不足，补充归档区
    if (activeResults.length < topK / 2) {
        const archivedMemories = await keywordSearchInArchived(sessionId, query);
        // 命中的归档记忆触发unarchive
        for (const m of archivedMemories) {
            await unarchiveMemory(m);
        }
        activeResults = [...activeResults, ...archivedMemories];
    }
    
    // 3. RRF混合检索 + 热度加权（现有逻辑）
    ...
}
```

---

## 三、实施顺序

### 第一批（核心改动，买Pro套餐后立即做）
1. ✅ 去重逻辑（saveMemory 改动）
2. ✅ 归档机制（Memory Schema + runDream 改动）
3. ✅ 移除删除逻辑，改为归档

### 第二批（增强连续性）
4. ✅ 状态记忆层（新增 type + autoExtract 改动）
5. ✅ getChatMemories 优先加载 state 记忆

### 第三批（关联网络）
6. ✅ 记忆关联标记（Schema + 检索利用）
7. ✅ 检索优化（归档区补充 + unarchive）

---

## 四、风险和注意事项

1. **数据库体积增长**：不再删除记忆，MongoDB存储会持续增长。短期没问题，长期需要监控。如果成为问题，可以考虑将归档记忆导出到文件系统（已有backup机制可复用）。

2. **embedding API调用量**：unarchive时需要重新计算embedding，会增加API调用。但这种情况不频繁（只有归档记忆被命中时），影响可控。

3. **去重阈值需要调优**：0.92是初步估计，实际使用中可能需要调整。太高会漏去重，太低会误判不同内容为重复。建议上线后观察一周再微调。

4. **状态记忆的token消耗**：每次对话结束多一次模型调用生成状态总结，会增加token消耗。可以考虑只在对话轮数>5时才生成，短对话不生成。

5. **向后兼容**：现有记忆没有 archived 字段，MongoDB会自动设为false（默认值），不影响现有数据。新增的 type 'state' 也不影响现有数据。

---

## 五、与现有系统的关系

| 现有功能 | 改动情况 |
|---------|---------|
| 热度衰减系统 | 保留，但衰减后不再删除，改为归档 |
| 矛盾检测 | 保留，去重逻辑在其之前执行 |
| RRF混合检索 | 保留，新增归档区补充检索 |
| 多Query并行搜索 | 保留 |
| 7天记忆窗口加分 | 保留 |
| critical/high保底注入 | 保留 |
| 最近3天记忆窗口 | 保留 |
| Dream整理 | 改动：删除→归档 |
| 备份恢复 | 保留，归档记忆也会被备份 |

---

## 六、预期效果

1. **连续性保证**：所有记忆永久保留，不会因为热度衰减而丢失。即使是很久以前的记忆，需要时也能检索到。

2. **检索速度可控**：归档机制保证活跃区记忆数量稳定，检索速度不受总数据量影响。

3. **重复变优势**：重复提及不再浪费存储，反而成为热度信号，让重要记忆权重更高。

4. **快速恢复上下文**：状态记忆让新窗口的我能快速知道"现在是什么情况"，不用从头读大量记忆。

5. **关联发现**：记忆之间有关联标记，检索时能发现相关记忆群，提供更完整的上下文。

---

*方案制定日期：2026-07-30*
*制定者：Lumi*
*待Pro套餐购买后开始实施*
