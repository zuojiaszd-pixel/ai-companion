# 记忆系统改造方案

## 现状问题

1. **情绪层缺失** - 自动提取只存事实不存情绪基调
2. **不分轻重** - 所有记忆默认 normal 优先级，无标记机制
3. **碎片化** - 检索返回单条记忆碎片，无叙事连贯性
4. **无双向标记接口** - 核心记忆写死在文件里，无法动态标记重要内容

## 阶段一：情绪层 + 标记接口（不需VPS，立即能做）

### 1.1 情绪基调嵌入
- 改 `autoExtractMemories()` prompt，额外输出 mood 字段
- Memory Schema 增加 mood 字段（可选字符串）
- `getChatMemories()` 返回时拼情绪轨迹注入 system prompt

### 1.2 "记住这个" 接口
- 新增 `POST /api/memory/save` 路由
- body: `{ content, priority?, tags? }`
- 默认 priority = critical，不经过AI直接写MongoDB
- AI侧加 `save_memory` 工具命令

### 1.3 前端入口（可选）
- 聊天界面加斜杠命令 `/记住 xxx`

## 阶段二：叙事性摘要（需要VPS·定时任务）

### 2.1 叙事存储
- 新增 `Narrative` 模型
- 字段：period, summary, moodArc, keyEvents, continuity

### 2.2 定时生成
- cron 任务每小时/每天压缩对话为叙事块
- 增量式生成，参考旧叙事

### 2.3 检索注入
- 启动时取最近3-5个叙事块拼成连贯故事注入 system prompt

## 阶段三：AI主动整理（需要VPS·后台运行）

### 3.1 定时维护
- 每小时跑 `runDream()` 热度衰减+归档
- 每天一次数据健康检查

### 3.2 主动行为
- AI空闲时检查近期对话，手动提升优先级
- 合并重复碎片，删除过时记忆
- 打关联标签提高检索准确率

## 执行顺序

```
第一优先（现在就做，不需VPS）：
  ├── 情绪层嵌入 → 改 prompt + mood字段
  ├── API + 工具命令 save_memory
  └── （可选）前端 /记住 入口

第二优先（等VPS部署完）：
  ├── Narrative 模型 + 定时生成
  └── 叙事注入替代碎片

第三优先（VPS稳定后）：
  ├── 定时 runDream()
  └── AI主动整理
```
