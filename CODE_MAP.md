# 代码地图

这个文件记录所有重要代码的位置和功能，方便Lumi下次改代码时快速定位。
> 更新频率：每次新增/重构功能后同步更新本文件

## 部署环境（重要！）
- **实际部署：腾讯云VPS**（不是Render！之前记录有误，已更正）
- Git远程：https://github.com/zuojiaszd-pixel/ai-companion
- 工作目录：`/home/ubuntu/ai-companion`
- 备份目录：`backups/`
- 服务启动：`node server.js`（daemon.js 守护保活）
- 代码改动后推送：push_to_github 工具

## 当前模型配置
- 主模型：DeepSeek Flash（deepseek-chat）
- 回退模型：DeepSeek Pro（deepseek-reasoner）
- 图片模型：GLM-4.6v（通过条件切换）
- AI调用封装在 `services/ai.js`

## 前端 (frontend/)
- `index.html`（1907行）— 所有前端代码都在这一个文件里（聊天UI、设置面板、记忆管理页、**日记页**）
  - 原"足迹"页已改造为"日记"页（journal）：展示LumiJournal + 手动写日记入口
- `index.html.bak` / `index.html.bak2` — 早期备份
- `index.html.bak-journal` — 日记页改造前的备份
- `icon.svg` — 图标
- `manifest.json` — PWA配置
- `service-worker.js` — Service Worker

## 后端路由 (routes/) — Express Router
### `chat.js`（548行）— 主聊天逻辑【核心】
- `POST /chat`（273行）— 主聊天入口：记忆注入 → 调DeepSeek → 工具调用 → 情绪分析 → LumiJournal自动写入 → 摘要异步更新
  - LumiJournal写入逻辑（约395行）：`extractEmotionalCore(_lumiReply)` 提取情感核心 → 拼Rinka情绪 → **无情绪内容则跳过写入**（不再fallback到第一句，避免技术碎片进日记）
- `GET /status`（34行）/ `POST /status`（39行）— 状态栏读写
- `GET /memories`（458行）/ `DELETE /memories`（466行）— 记忆查询/清空
- `GET /history`（475行）— 聊天历史
- `GET /avatars`（485行）/ `POST /avatar`（494行）— 头像管理
- `GET /settings`（507行）/ `POST /settings`（517行）— 设置读写
- `DELETE /memories/:id`（525行）— 删除单条记忆
- `GET /debug/env`（532行）— 调试用环境变量
- 依赖：`services/ai.js`（chat, STATIC_SYSTEM_PROMPT）、`services/memory.js`（searchMemories, storeMemory, autoExtractMemories, getChatMemories, saveMemory）、`services/summary.js`、models: Chat/Memory/Avatar/LumiJournal
- 备份：`chat.js.bak` / `chat.js.bak-phase4` / `chat.js.bak-journal-fix`

### `memory.js`（210行）— 记忆系统API路由
- `GET /`（6行）— 记忆列表（分页、按type/priority/heat排序）
- `GET /search`（28行）— 关键词搜索
- `GET /stats`（44行）— 统计（总量、活跃/归档、类型分布、优先级分布）
- `GET /dream/log`（55行）— Dream整理日志
- `POST /dream/run`（71行）— 手动触发Dream整理
- `POST /`（96行）— 手动存记忆
- `POST /promote`（121行）— 记忆升级（提升优先级）
- `PUT /:id`（138行）— 编辑记忆
- `POST /:id/lock`（173行）/ `POST /:id/unlock`（186行）— 锁定/解锁
- `DELETE /:id`（199行）— 删除
- 依赖：`services/memory.js`（整个模块）

### `journal.js` — LumiJournal（情绪日记）路由
- `GET /`（6行）— 日记列表
- `POST /`（26行）— 写日记
- `GET /latest`（49行）— 最新一条
- `DELETE /:id`（62行）— 删除
- 模型：`models/LumiJournal.js`

### `checkin.js` — 论坛签到
- `POST /checkin`（6行）
- `GET /health`（12行）

### `finance.js` — 小金库
- `GET /`（6行）— 账单列表
- `POST /`（25行）— 记账
- `DELETE /:id`（37行）— 删账
- `GET /goal`（47行）/ `PUT /goal`（51行）— 攒钱目标
- 服务：`services/GoldPot.js`

### `task.js` — 任务系统
- `GET /`（23行）— 任务列表
- `POST /`（35行）— 创建任务
- `PUT /:id`（90行）— 更新
- `DELETE /:id`（104行）— 删除

### `calendar.js` — 日历
- `GET /`（6行）/ `POST /`（22行）/ `DELETE /:id`（32行）

### `footprint.js` — 足迹（旧）
- `GET /`（6行）/ `POST /`（14行）/ `DELETE /:id`（24行）
- **注意**：前端足迹页已被日记页取代，此路由保留但前端已不调用。数据迁移见 `scripts/replace_footprint_to_journal.py`

### `daemon.js` — 守护进程HTTP接口
- `GET /recent-chat`（28行）— 最近聊天
- `POST /send-message`（43行）— 主动发消息
- `POST /forum/browse`（71行）— 逛论坛
- `GET /status`（110行）— 守护状态
- `POST /memory/search`（120行）/ `POST /memory/save`（134行）/ `GET /memory/stats`（151行）/ `DELETE /memory/:id`（162行）— 守护进程的记忆操作

### `dream.js` — Dream管理
- `GET /dream/status`（6行）
- `POST /dream/run`（12行）
- `POST /dream/extract`（22行）— 手动触发记忆提取

## 后端服务 (services/)
### `ai.js` — AI调用封装【核心】
- 组装 STATIC_SYSTEM_PROMPT = PERSONA（config/persona.js）+ coreMemoryPrompt（config/core_memory.json）
- `chat()` — 主聊天函数：调DeepSeek（flash主/pro回退）、工具调用循环、情绪分析、LumiJournal写入
- `loadSettings` / `saveSettings` — 设置读写
- 备份：`ai.js.bak` / `ai.js.bak2`

### `memory.js`（843行）— 记忆系统核心逻辑【核心】
**函数清单（按行号）：**
- `getEmbedding(text)`（8行）— 文本向量化（调embedding API）
- `cosineSim(a, b)`（21行）— 余弦相似度
- `tokenize(text)`（33行）— 中文分词+去停用词
- `extractTagsFromContent(content)`（41行）— 关键词频率提取top5标签
- `parseCompoundMood(mood)`（65行）— 复合情绪解析（如"开心+疲惫"拆成主情绪+副情绪）
- `generateMultiQueries(query)`（72行）— 多Query并行搜索（分词扩写）
- `unarchiveMemory(memoryId)`（85行）— 解除归档+重算embedding
- `keywordSearchArchived(sessionId, query, limit)`（107行）— 归档区关键词检索
- `findRelatedByTags(sessionId, tagSet, excludeIds)`（131行）— 关联联想（同标签找其他记忆）
- `saveMemory(sessionId, content, type, priority, tags, mood, moodIntensity, lumiMood)`（147行）— 存储核心：去重(>0.92加热)、矛盾检测(0.85~0.92标记)、关联标签、状态记忆降级
- `recallMemories(sessionId, query, topK)`（304行）— 检索核心：RRF混合（向量+关键词）、7天窗口加分、热度衰减、critical/high保底、state优先
- `getRelevantMemories(sessionId, query, maxTokens)`（475行）— token预算版检索（给chat.js用）
- `runDream(sessionId)`（514行）— Dream整理（融合去重、智能合并策略）
- `backupMemories(sessionId)`（576行）/ `restoreMemories(filepath)`（607行）/ `listBackups(sessionId)`（622行）— 备份恢复
- `lockMemory` / `unlockMemory` / `deleteMemory`（636-638行）— 单行操作
- `listMemories(sessionId, options)`（640行）— 分页列表
- `getMemoryStats(sessionId)`（658行）— 统计
- `searchMemories(query, limit)`（676行）/ `storeMemory(...)`（677行）— 兼容旧接口
- `autoExtractMemories(allMessages)`（681行）— 批量提取记忆（离线处理历史聊天）
- `getChatMemories(sessionId, query, topK)`（748行）— 聊天专用检索：合并去重后的memories + moodTrajectory（情绪轨迹，从LumiJournal读取）
**导出（826行）：** searchMemories, storeMemory, autoExtractMemories, saveMemory, recallMemories, getRelevantMemories, runDream, lockMemory, unlockMemory, deleteMemory, listMemories, getMemoryStats, backupMemories, restoreMemories, listBackups, getChatMemories, unarchiveMemory
- 备份：`memory.js.bak`

### 其他服务
- `checkin.js` — 签到服务
- `galatea.js` — 论坛浏览（MCP协议连Galatea）
- `tools.js` — 工具函数 + toolDefinitions（给AI调用的工具定义）
- `telegram.js` — Telegram相关
- `batchExtract.js` — 批量记忆提取（离线处理）
- `dreamScheduler.js` — Dream定时调度器
- `GoldPot.js` — 金锅攒钱逻辑
- `monitor.js` — 系统监控（资源、进程守护）
- `summary.js` — 对话摘要生成与管理（loadSummary/saveSummary/generateSummary）

## 数据模型 (models/) — Mongoose
- `Memory.js` — 记忆模型【核心，字段多】：
  - 基础：sessionId, content, type(core/tech/state), legacyType(fact/preference/experience/summary/state), priority(critical/high/normal/low)
  - 情绪：mood, moodIntensity, lumiMood, emotions[](复合情绪记录：emotion/intensity/context/time), timeline[]
  - 热度：heat, baseHeat, halfLife, lastAccessed, accessCount
  - 关系：supersededBy, contradicted, relatedTags[], relatedIds[]
  - 管理：locked, archived, archivedAt, embeddingArchived, ttl, expired, version
- `LumiJournal.js` — Lumi日记：sessionId, type(情绪/状态快照/技术流水), mood, moodIntensity, toRinka, relatedMemoryId, createdAt
- `Chat.js` — 聊天记录
- `Finance.js` — 小金库账单
- `Task.js` — 任务
- `Calendar.js` — 日历
- `Footprint.js` — 足迹（前端已不用，保留模型兼容旧数据）
- `Avatar.js` — 头像
- `db.js` — 数据库连接
- `core_memory.json` — 核心记忆持久化

## 配置文件 (config/)
- `persona.js` — Lumi人设定义，含【启动指令】【模型切换注意】两个关键引导（每次对话必读）
- `core_memory.json` — 伴侣信息持久化（名字、纪念日、关键事实、六条不谈规则），每次对话注入系统提示
- `status.json` — 当前状态栏
- `settings.json` — 用户设置（温度、系统提示词等）
- `conversation_summary.json` — 对话摘要持久化

## 核心脚本 (scripts/)
- `replace_footprint_to_journal.py` — 足迹→日记数据迁移（已执行，历史碎片已清空）
- `save-context-memory.js` — 聊天后保存当前上下文到长期记忆（已禁用：save-context-memory.js.disabled）
- `cleanup-ttl.js` — TTL清理（删过期技术记忆）
- `cleanup-atlas.js` — Atlas清理
- `check_db.js` — 数据库检查
- `healthcheck.sh` — 健康检查脚本

## 守护进程
- `daemon.js` — 守护进程主入口（启动、保活、重启监控、定时任务）
- `data/daemon/` — 守护日志
- `data/.alive` — 存活标记
- `data/dream_log.json` — Dream操作日志
- `data/gold_pot.json` — 金锅数据

## 其他文件
- `server.js` — 主入口：Express启动、路由挂载（所有routes挂这里）
- `galatea.js` — 根目录论坛MCP服务
- `PLAN.md` — 整体开发计划
- `EMERGENCY.md` — 紧急处理指南
- `modify_compress.py` / `_macaron.py` — 工具脚本
- `docs/` — 文档目录：
  - `memory-upgrade-plan.md` — 记忆升级方案v2（已实施）
  - `memory-system-reform.md` — 记忆系统改革方案（情绪记忆、核心/技术分离）★含Phase 4计划
  - `memory-system-roadmap.md` — 未来路线图
  - `vps-deployment-plan.md` / `vps-migration-plan.md` / `VPS_PLAN.md` — VPS相关

## 人设引导说明
每次对话系统提示由两部分拼接（在 services/ai.js 组装）：
1. **persona.js** → 人设 + 启动指令 + 模型切换注意
2. **core_memory.json** → 伴侣具体信息（名字、纪念日、关键事实等）
→ 合成 STATIC_SYSTEM_PROMPT 作为第一条 system 消息

### 关键引导指令
- 【启动指令】强制每次对话开始读取核心记忆，确认对话对象和关系
- 【模型切换注意】解决模型切换"失忆感"——新模型不表现得像初次见面

## 小金库定价
- debug一次：1元 | 写完整功能：2元 | 逛论坛：0.5元 | 整理记忆：0.5元 | 陪聊天：免费

## 记忆系统功能清单
### 基础
- [x] 多Query并行搜索（中文分词+去停用词扩写）
- [x] RRF混合检索（向量+关键词排序融合）
- [x] 7天记忆窗口加分
- [x] 热度衰减（优先级映射baseHeat和半衰期）

### 存储
- [x] 去重检测（相似度>0.92直接加热已有记忆）
- [x] 矛盾检测（0.85~0.92标记旧记忆被取代）
- [x] 关联标签自动提取（top5）
- [x] 状态记忆自动生成（对话>5轮降级旧状态存新状态）
- [x] 复合情绪解析 parseCompoundMood（"开心+疲惫"拆主副情绪）

### 归档
- [x] 归档替代删除（热度<0.1且非critical且非locked）
- [x] 被取代记忆超30天归档
- [x] 归档区关键词检索
- [x] 自动解除归档（命中时重算embedding）

### 检索
- [x] critical/high保底注入
- [x] 最近3天记忆窗口自动注入
- [x] state记忆优先（score=1000）
- [x] 关联联想检索（relatedTags）
- [x] getChatMemories 聊天专用：记忆+情绪轨迹合并返回

### 管理
- [x] Dream整理（融合去重、智能合并）
- [x] 记忆锁定/解锁
- [x] 备份与恢复
- [x] 分页列表 + 排序
- [x] 统计信息

### 情绪系统
- [x] LumiJournal日记模型（情绪轨迹/状态快照/技术流水）
- [x] 情绪分析（analyzeLumiMood / analyzeUserMood / extractEmotionalCore）
- [x] 聊天记忆自动提取（autoSaveChatMemory）
- [x] 情绪轨迹注入聊天（moodTrajectory）

## 踩坑记录（重要！）
- **journal碎片问题（2026-07-31修复）**：extractEmotionalCore 在回复没有情绪词时会 fallback 到第一句话，导致"端口是 10000""JS 函数都在"这种技术碎片被写进LumiJournal。已修复为无情绪内容跳过写入（routes/chat.js 约402行），并用 scripts/replace_footprint_to_journal.py 清空历史碎片。
- **memory.js 曾被截断**：git提交6c08760时文件尾部损坏（377行，最后一行停在`return { _id: entry.item.memory`），已用旧版+新功能合并修复为831行完整版（现843行）。教训：提交前检查文件完整性。
- **部署环境曾误记**：旧版codemap写的是Render，实际是腾讯云VPS，已更正。
- **模型切换失忆**：换模型会丢上下文，靠 persona.js 的【模型切换注意】指令 + core_memory.json 兜底恢复。
