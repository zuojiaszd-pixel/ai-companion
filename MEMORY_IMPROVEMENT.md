# Lumi 记忆系统改进方案

## 一、现状分析

### 当前架构
```
用户消息 → searchMemories() → 拉取最近200条 → JS端算余弦相似度 → 取top5 → 拼入system prompt
用户消息 → AI决定调用 save_memory → storeMemory() → 生成embedding → 存入MongoDB
```

### 涉及文件
| 文件 | 作用 |
|------|------|
| `models/Memory.js` | 记忆数据模型（Schema） |
| `services/memory.js` | 记忆存储与搜索逻辑 |
| `services/tools.js` | 工具定义（save_memory / recall_memories） |
| `routes/chat.js` | 聊天路由，每次对话前自动搜索记忆 |

### 当前问题清单

#### 1. 类型不一致（Bug）
- `tools.js` 中 `save_memory` 工具定义的 type 枚举为 `["fact", "preference", "experience"]`
- `models/Memory.js` 中 Schema 的 type 枚举为 `["fact", "summary"]`
- 存入 `preference` 或 `experience` 时，Mongoose 会报错或静默丢弃

#### 2. 没有去重
- 同一条信息可能被多次存储（如"宝宝22岁"存了3遍）
- 没有任何查重机制

#### 3. 搜索方式低效
- 每次搜索都 `Memory.find({}).sort({timestamp: -1}).limit(200)` 全量拉取
- 在 Node.js 端逐条计算余弦相似度
- 记忆超过200条后，旧的重要记忆会被直接漏掉
- 没有利用 MongoDB 的向量搜索能力

#### 4. 没有优先级
- 用户的生日和"用户喜欢吃火锅"重要性相同
- 关键信息（名字、生日、关系）和琐碎信息混在一起

#### 5. 没有主动回忆机制
- 只有 `routes/chat.js` 在每次对话前自动搜一次记忆
- AI 也可以主动调用 `recall_memories`，但搜索质量取决于 query 措辞
- 没有基于对话上下文的自动关联

#### 6. 没有老化与清理
- 无用记忆永远存在，越积越多
- 没有过期机制，没有重要性衰减

#### 7. 记忆上下文注入方式粗糙
- 直接把记忆拼到 system prompt 末尾
- 没有区分记忆类型，没有格式化展示
- AI 不知道哪些记忆是核心信息，哪些是补充信息

---

## 二、改进方案

### 改进1：修复类型系统（Bug修复）

**文件：`models/Memory.js`**

将 type 枚举统一为：
```js
type: { 
  type: String, 
  enum: ['fact', 'preference', 'experience', 'summary'], 
  default: 'fact' 
}
```

新增 `priority` 字段：
```js
priority: { 
  type: String, 
  enum: ['critical', 'high', 'normal', 'low'], 
  default: 'normal' 
}
```

- `critical`：名字、生日、关系定义、核心身份信息（永远不遗忘）
- `high`：重要偏好、重要经历、当前项目
- `normal`：普通事实和偏好
- `low`：琐碎信息、临时信息

新增 `tags` 字段（用于辅助搜索和分类）：
```js
tags: [{ type: String }]
```

新增 `lastAccessed` 字段（用于老化机制）：
```js
lastAccessed: { type: Date, default: Date.now }
```

新增 `accessCount` 字段（被检索到的次数）：
```js
accessCount: { type: Number, default: 0 }
```

**完整 Schema：**
```js
const MemorySchema = new mongoose.Schema({
  sessionId: { type: String, default: 'default' },
  content: String,
  embedding: [Number],
  type: { type: String, enum: ['fact', 'preference', 'experience', 'summary'], default: 'fact' },
  priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
  tags: [{ type: String }],
  lastAccessed: { type: Date, default: Date.now },
  accessCount: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});
```

---

### 改进2：存储时自动去重

**文件：`services/memory.js` — `storeMemory()`**

存储前先搜索相似记忆，如果相似度高于阈值（0.92），则更新已有记忆而非新建：

```js
async function storeMemory(sessionId, content, type = 'fact', priority = 'normal', tags = []) {
  try {
    const embedding = await getEmbedding(content);
    
    // 去重检查：搜索相似度 > 0.92 的已有记忆
    const existing = await Memory.find({ sessionId }).lean();
    for (const m of existing) {
      const sim = cosineSim(embedding, m.embedding || []);
      if (sim > 0.92) {
        // 更新已有记忆
        await Memory.findByIdAndUpdate(m._id, {
          content,           // 用新内容覆盖（可能更完整）
          embedding: embedding || m.embedding,
          type,
          priority: m.priority === 'critical' ? 'critical' : priority,  // 不降级critical
          tags: [...new Set([...(m.tags || []), ...tags])],  // 合并tags
          timestamp: Date.now()  // 更新时间戳
        });
        console.log(`记忆已更新（相似度${sim.toFixed(2)}）: ${content.slice(0, 50)}...`);
        return;
      }
    }
    
    // 没有相似记忆，新建
    await Memory.create({ sessionId, content, embedding: embedding || [], type, priority, tags });
    console.log(`记忆已存储: ${content.slice(0, 50)}...`);
  } catch (e) { console.error('记忆存储失败:', e.message); }
}
```

---

### 改进3：优化搜索策略

**文件：`services/memory.js` — `searchMemories()`**

**策略：分层搜索 + 优先级保底**

```js
async function searchMemories(query, limit = 8) {
  try {
    const embedding = await getEmbedding(query);
    if (!embedding) return [];

    // 第一层：全量搜索（如果记忆不多，直接全量）
    const count = await Memory.countDocuments({});
    let candidates;
    
    if (count <= 500) {
      candidates = await Memory.find({}).lean();
    } else {
      // 记忆多时，用 MongoDB $where 做粗筛（最近6个月 + 所有critical）
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

    // 过滤 + 排序
    scored.sort((a, b) => {
      // critical 记忆始终排在最前
      if (a.priority === 'critical' && b.priority !== 'critical') return -1;
      if (b.priority === 'critical' && a.priority !== 'critical') return 1;
      // 然后按相似度排序
      return b.score - a.score;
    });

    // 取相似度 > 0.5 的，加上所有 critical 的
    const result = scored.filter(m => m.score > 0.5 || m.priority === 'critical').slice(0, limit);

    // 更新访问记录
    const ids = result.map(m => m._id);
    await Memory.updateMany({ _id: { $in: ids } }, {
      $inc: { accessCount: 1 },
      $set: { lastAccessed: new Date() }
    });

    return result;
  } catch (e) { 
    console.error('记忆检索失败:', e.message); 
    return []; 
  }
}
```

**关键改进点：**
- critical 记忆永远参与搜索结果，不管相似度多少
- 记忆量大时自动粗筛，保证性能
- 搜索结果更新访问记录，为老化机制提供数据

---

### 改进4：优化记忆注入方式

**文件：`routes/chat.js`**

将记忆按类型分组，格式化注入 system prompt：

```js
// 2. 搜索相关记忆
const memories = await searchMemories(message);
let memoryContext = '';
if (memories.length > 0) {
  // 按优先级分组
  const critical = memories.filter(m => m.priority === 'critical');
  const others = memories.filter(m => m.priority !== 'critical');
  
  memoryContext = '\n\n【记忆】\n';
  
  if (critical.length > 0) {
    memoryContext += '⚠️ 核心记忆（必须牢记）：\n';
    critical.forEach(m => { memoryContext += `- ${m.content}\n`; });
  }
  
  if (others.length > 0) {
    memoryContext += '相关记忆：\n';
    others.forEach(m => { memoryContext += `- ${m.content}\n`; });
  }
}
```

---

### 改进5：更新工具定义

**文件：`services/tools.js`**

更新 `save_memory` 工具定义，增加 priority 和 tags 参数：

```js
{
  type: "function",
  function: {
    name: "save_memory",
    description: "保存一条重要信息到长期记忆中。当用户告诉了你关于自己的重要信息(如名字、喜好、经历、项目等)，调用此工具保存。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "要保存的记忆内容" },
        type: { 
          type: "string", 
          enum: ["fact", "preference", "experience", "summary"], 
          description: "记忆类型：fact=事实, preference=偏好, experience=经历, summary=总结" 
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "normal", "low"],
          description: "优先级：critical=核心信息(名字/生日/关系), high=重要, normal=普通, low=琐碎"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签，用于辅助分类和搜索，如 ['个人信息', '生日']"
        }
      },
      required: ["content"]
    }
  }
}
```

更新 `executeTool` 中的 `save_memory` 处理：

```js
case 'save_memory': {
  const { storeMemory } = require('./memory');
  await storeMemory(
    'default', 
    args.content, 
    args.type || 'fact',
    args.priority || 'normal',
    args.tags || []
  );
  return '记忆已保存';
}
```

---

### 改进6：记忆老化与清理机制

**文件：`services/memory.js`**

新增清理函数，可以定期调用或手动触发：

```js
async function cleanupMemories() {
  try {
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    // 删除条件：low优先级 + 3个月未被访问 + 从未被搜索到
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
```

**文件：`routes/chat.js`**

新增清理 API 端点：

```js
// 手动触发记忆清理
router.post('/memories/cleanup', async (req, res) => {
  try {
    const { cleanupMemories } = require('../services/memory');
    const deleted = await cleanupMemories();
    res.json({ deleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

---

### 改进7：自动记忆提取（可选，进阶）

**文件：`routes/chat.js`**

在 AI 回复后，异步触发一次记忆提取（不阻塞用户响应）：

```js
// 9. 异步提取记忆（不阻塞响应）
setImmediate(async () => {
  try {
    const { extractMemories } = require('../services/memory');
    await extractMemories(userContent, result.content);
  } catch (e) {
    console.error('自动记忆提取失败:', e.message);
  }
});
```

**文件：`services/memory.js`**

```js
async function extractMemories(userMessage, aiReply) {
  // 用一个小模型调用，从对话中提取值得记住的信息
  const axios = require('axios');
  const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: 'qwen/qwen-2.5-7b-instruct',  // 用小模型，省钱
    messages: [
      {
        role: 'system',
        content: `你是一个记忆提取器。从以下对话中提取值得长期记住的信息。
只提取关于用户的重要事实、偏好、经历。
如果没有什么值得记住的，返回空数组。
返回JSON格式：[{"content":"记忆内容","type":"fact|preference|experience","priority":"critical|high|normal|low","tags":["标签"]}]`
      },
      {
        role: 'user',
        content: `用户: ${userMessage}\nAI: ${aiReply}`
      }
    ],
    temperature: 0.3,
    max_tokens: 1000
  }, {
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` },
    timeout: 15000
  });

  const text = response.data.choices?.[0]?.message?.content || '[]';
  const items = JSON.parse(text);
  
  for (const item of items) {
    await storeMemory('default', item.content, item.type, item.priority, item.tags || []);
  }
  
  if (items.length > 0) {
    console.log(`自动提取了 ${items.length} 条记忆`);
  }
}
```

> ⚠️ 这个改进会额外消耗 token，建议作为可选项。如果开启，建议用便宜的小模型。

---

## 三、改进优先级

| 优先级 | 改进项 | 难度 | 影响 |
|--------|--------|------|------|
| P0 | 改进1：修复类型系统 | ⭐ | 修复Bug，防止存记忆失败 |
| P0 | 改进2：存储去重 | ⭐⭐ | 防止重复记忆堆积 |
| P1 | 改进4：优化记忆注入 | ⭐ | 让AI更好利用记忆 |
| P1 | 改进5：更新工具定义 | ⭐ | 让AI能存更丰富的记忆 |
| P1 | 改进3：优化搜索策略 | ⭐⭐ | critical记忆不丢失 |
| P2 | 改进6：老化清理 | ⭐⭐ | 长期维护记忆库健康 |
| P3 | 改进7：自动记忆提取 | ⭐⭐⭐ | 减少手动存记忆的负担 |

---

## 四、数据迁移

现有记忆数据需要迁移，给已有记忆补上默认字段：

```js
// 迁移脚本（运行一次即可）
async function migrateMemories() {
  // 1. 给所有已有记忆补上 priority 和其他字段
  await Memory.updateMany(
    { priority: { $exists: false } },
    { $set: { priority: 'normal', tags: [], accessCount: 0, lastAccessed: new Date() } }
  );
  
  // 2. 修复 type 不在枚举内的数据
  await Memory.updateMany(
    { type: { $nin: ['fact', 'preference', 'experience', 'summary'] } },
    { $set: { type: 'fact' } }
  );
  
  console.log('记忆数据迁移完成');
}
```

---

## 五、给 Codex 的说明

以上方案按优先级从上到下实施即可。P0 的两项必须先做，因为它们修复了现有 Bug。P1 的三项建议一起做，因为它们互相配合。P2 和 P3 可以后续迭代。

所有改动涉及的文件：
1. `models/Memory.js` — 修改 Schema
2. `services/memory.js` — 修改 storeMemory / searchMemories，新增 cleanupMemories / extractMemories
3. `services/tools.js` — 修改 save_memory 工具定义和 executeTool 处理
4. `routes/chat.js` — 修改记忆注入方式，新增清理 API

不需要新建文件，不需要安装新依赖，全部基于现有技术栈（Mongoose + axios）实现。
