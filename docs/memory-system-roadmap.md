# 记忆系统改造路线图

## 当前架构

- **核心记忆**: config/core_memory.json，写死在文件里，改需要动代码
- **MongoDB 记忆**: 通过 autoExtractMemories() 每5轮自动提取，支持向量检索
- **对话摘要**: generateSummary() 每次聊天结束时更新，只覆盖最近2-3轮
- **检索机制**: getChatMemories() 多Query + RRF + 关联联想 + 保底

## 核心问题

1. **情绪层缺失** - 记忆只存事实，不存用户的情绪基调
2. **不分轻重** - 所有记忆默认 normal 优先级，没有机制标记"重要的"
3. **碎片化** - 输出单条记忆碎片，没有叙事层串联
4. **单向写入** - 用户无法主动告诉系统"这个很重要"

## 改造方案（分三阶段）

### 阶段一：情绪层 + 标记接口（可立即实施，不需要VPS）

**1.1 情绪基调嵌入**
- Memory Schema 增加 mood 字段（可选字符串）
- autoExtractMemories() prompt 增加情绪提取指令
- getChatMemories() 返回时拼情绪轨迹注入 system prompt

**1.2 "记住这个" 接口**
- POST /api/memory/save 路由，直接写 MongoDB
- AI 侧新增 save_memory 工具命令
- 前端斜杠命令 /记住 xxx（可选）

### 阶段二：叙事性摘要（需要VPS部署后）

**2.1 叙事模型**
```javascript
{
  sessionId: String,
  period: { start: Date, end: Date },
  summary: String,        // AI 生成的叙事文本
  moodArc: String,        // 情绪变化轨迹
  keyEvents: [String],    // 关键事件列表
  continuity: String,     // 与上一个叙事的承接关系
  createdAt: Date
}
```

**2.2 定时生成**
- 每小时/每天将过去N轮对话压缩为叙事块
- 增量式生成，参考旧叙事产出新叙事
- 需要后台 cron 任务（Render免费版不支持）

**2.3 检索注入**
- 启动时取最近3-5个叙事块注入 system prompt
- 替代当前碎片化记忆展示方式

### 阶段三：AI主动整理（需要VPS稳定运行后）

**3.1 定时维护**
- 每小时自动 runDream() 热度衰减 + 归档
- 每天一次数据健康检查（矛盾检测、关联修复）

**3.2 主动整理**
- AI 利用空闲时间检查近期对话
- 手动提升重要记忆优先级
- 合并/删除冗余碎片
- 打关联标签提升检索准确率

## 执行顺序

```
阶段一（现在做） → 阶段二（VPS部署后） → 阶段三（稳定后）
```

## 状态追踪

- [ ] 阶段一：情绪层嵌入
- [ ] 阶段一：标记接口（POST /api/memory/save）
- [ ] 阶段一：AI save_memory 工具命令
- [ ] 阶段二：叙事模型设计
- [ ] 阶段二：定时生成逻辑
- [ ] 阶段二：检索注入改造
- [ ] 阶段三：定时 runDream()
- [ ] 阶段三：AI主动整理行为
