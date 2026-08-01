# 代码地图

这个文件记录所有重要代码的位置和功能，方便Lumi下次改代码时快速定位。
> 更新频率：每次新增/重构功能后同步更新本文件

## 部署环境（重要！）
- **实际部署：腾讯云VPS**（不是Render！）
- Git远程：https://github.com/zuojiaszd-pixel/ai-companion
- 工作目录：`/home/ubuntu/ai-companion`
- 备份目录：`backups/`
- 服务启动：`node server.js`（daemon.js 守护保活）
- 代码改动后推送：push_to_github 工具
- 数据库：MongoDB（连接在 `config/db.js`）

## 当前模型配置
- 主模型：DeepSeek Flash（deepseek-chat）
- 回退模型：DeepSeek Pro（deepseek-reasoner）
- 图片模型：GLM-4.6v（通过条件切换）
- AI调用封装在 `services/ai.js`

## 前端 (frontend/)
- `index.html`（1836行）— 所有前端代码都在这一个文件里（聊天UI、MCP管理、日历、记忆管理、小金库）
  - 页面：`page-chat`（聊天主页）、`page-mcp`（MCP管理）、`page-calendar`（日历）、`page-memory`（记忆管理）、`page-finance`（小金库）
  - 顶部下拉菜单：缓存命中显示、模型切换、MCP入口、夜间模式、设置、刷新
  - **日记页已删除（8月1日）、任务页已删除（8月1日）**
- `index.html.bak` / `index.html.bak2` — 早期备份
- `index.html.bak-journal` — 日记页删除前备份
- `index.html.bak-task-20260801-213233` — 任务页删除前备份
- `icon.svg` — 图标
- `manifest.json` — PWA配置
- `service-worker.js` — Service Worker

## 后端路由 (routes/) — Express Router
### `chat.js`（436行）— 主聊天逻辑【核心】
- `POST /chat`（约270行）— 主聊天入口：相关记忆按关联度+token预算1200注入 → 调DeepSeek → 工具调用 → 情绪分析 → LumiJournal写入 → 摘要异步更新
  - **注意**：LumiJournal 模型已删除（日记功能移除），聊天写入逻辑需确认是否已同步清理
  - 记忆注入方式：`getRelevantMemories(sessionId, query, 1200)` 按关联度筛选+token预算，不再全量拼接（7月31日恢复注入）
- `GET /status` / `POST /status` — 状态栏读写
- `GET /memories` / `DELETE /memories` — 记忆查询/清空
- `GET /history` — 聊天历史
- `GET /avatars` / `POST /avatar` — 头像管理
- `GET /settings` / `POST /settings` — 设置读写（支持 contextRounds 20轮，已解除10轮硬编码限制）
- `DELETE /memories/:id` — 删除单条记忆
- `GET /debug/env` — 调试用环境变量
- 依赖：`services/ai.js`（chat, STATIC_SYSTEM_PROMPT）、`services/memory.js`、`services/summary.js`、models: Chat/Memory/Avatar

### `memory.js`（212行）— 记忆系统API路由
- `GET /` — 记忆列表（分页、按type/priority/heat排序）
- `GET /search` — 关键词搜索
- `GET /stats` — 统计（总量、活跃/归档、类型分布、优先级分布）
- `GET /dream/log` — Dream整理日志
- `POST /dream/run` — 手动触发Dream整理
- `POST /` — 手动存记忆
- `POST /promote` — 记忆升级（提升优先级）
- `PUT /:id` — 编辑记忆
- `POST /:id/lock` / `POST /:id/unlock` — 锁定/解锁
- `DELETE /:id` — 删除
- 依赖：`services/memory.js`（整个模块）

### `finance.js`（57行）— 小金库
- `GET /` — 账单列表
- `POST /` — 记账
- `DELETE /:id` — 删账
- `GET /goal` / `PUT /goal` — 攒钱目标
- 服务：`services/GoldPot.js`

### `calendar.js`（39行）— 日历
- `GET /` / `POST /` / `DELETE /:id`

### `footprint.js`（31行）— 足迹（旧）
- `GET /` / `POST /` / `DELETE /:id`
- **注意**：前端足迹页已下线，此路由保留但前端已不调用

### `daemon.js`（173行）— 守护进程HTTP接口
- `GET /recent-chat` — 最近聊天
- `POST /send-message` — 主动发消息
- `POST /forum/browse` — 逛论坛
- `GET /status` — 守护状态
- `POST /memory/search` / `POST /memory/save` / `GET /memory/stats` / `DELETE /memory/:id` — 守护进程的记忆操作

### `dream.js`（31行）— Dream管理
- `GET /dream/status` / `POST /dream/run` / `POST /dream/extract`

### `checkin.js`（16行）— 签到
- `POST /checkin` / `GET /health`

### `mcp.js`（124行）— MCP管理
- MCP服务器配置管理接口

### 已删除的路由（8月1日）
- ~~`task.js` — 任务系统~~（已删，备份 `task.js.bak-20260801-213233`）
- ~~`journal.js` — 日记路由~~（已删）

## 后端服务 (services/)
### `ai.js`（605行）— AI调用封装【核心】
- 组装 STATIC_SYSTEM_PROMPT = PERSONA（config/persona.js）+ coreMemoryPrompt（config/core_memory.json）
- `chat()` — 主聊天函数：调DeepSeek（flash主/pro回退）、工具调用循环、情绪分析
- `loadSettings` / `saveSettings` — 设置读写
- 备份：`ai.js.bak` / `ai.js.bak2`

### `memory.js`（845行）— 记忆系统核心逻辑【核心】
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
- `saveMemory(...)`（147行）— 存储核心：去重(>0.92加热)、矛盾检测(0.85~0.92标记)、关联标签、状态记忆降级
- `recallMemories(sessionId, query, topK)`（304行）— 检索核心：RRF混合（向量+关键词）、7天窗口加分、热度衰减、critical/high保底、state优先
- `getRelevantMemories(sessionId, query, maxTokens)`（475行）— token预算版检索（给chat.js用，当前预算1200）
- `runDream(sessionId)`（514行）— Dream整理（融合去重、智能合并策略）
- `backupMemories` / `restoreMemories` / `listBackups`（576-622行）— 备份恢复
- `lockMemory` / `unlockMemory` / `deleteMemory`（636-638行）
- `listMemories(sessionId, options)`（640行）— 分页列表
- `getMemoryStats(sessionId)`（658行）— 统计
- `searchMemories` / `storeMemory`（676-677行）— 兼容旧接口
- `autoExtractMemories(allMessages)`（681行）— 批量提取记忆（离线处理历史聊天）
- `getChatMemories(sessionId, query, topK)`（748行）— 聊天专用检索：合并去重后的memories + moodTrajectory（情绪轨迹）
- **导出（826行）**：searchMemories, storeMemory, autoExtractMemories, saveMemory, recallMemories, getRelevantMemories, runDream, lockMemory, unlockMemory, deleteMemory, listMemories, getMemoryStats, backupMemories, restoreMemories, listBackups, getChatMemories, unarchiveMemory
- 备份：`memory.js.bak`

### 其他服务
- `GoldPot.js`（84行）— 金锅攒钱逻辑
- `checkin.js`（496行）— 签到服务
- `telegram.js`（290行）— Telegram相关
- `galatea.js`（209行）— 论坛浏览（MCP协议连Galatea）
- `tools.js`（214行）— 工具函数 + toolDefinitions（给AI调用的工具定义）
- `mcpManager.js`（246行）— MCP服务器管理
- `batchExtract.js`（112行）— 批量记忆提取（离线处理）
- `dreamScheduler.js`（233行）— Dream定时调度器
- `monitor.js`（174行）— 系统监控（资源、进程守护）
- `summary.js`（43行）— 对话摘要生成与管理（loadSummary/saveSummary/generateSummary）

## 数据模型 (models/) — Mongoose
- `Memory.js`（226行）— 记忆模型【核心，字段多】：
  - 基础：sessionId, content, type(core/tech/state), legacyType, priority(critical/high/normal/low)
  - 情绪：mood, moodIntensity, lumiMood, emotions[], timeline[]
  - 热度：heat, baseHeat, halfLife, lastAccessed, accessCount
  - 关系：supersededBy, contradicted, relatedTags[], relatedIds[]
  - 管理：locked, archived, archivedAt, embeddingArchived, ttl, expired, version
- `Chat.js` — 聊天记录
- `Finance.js` — 小金库账单
- `Calendar.js` — 日历
- `Footprint.js` — 足迹（前端已不用，保留模型兼容旧数据）
- `Avatar.js` — 头像
- 已删除：~~`Task.js`（任务）~~、~~`LumiJournal.js`（日记）~~ — 均于8月1日移除

## 配置文件 (config/)
- `db.js` — 数据库连接（MongoDB）
- `persona.js` — Lumi人设定义，含【启动指令】【模型切换注意】两个关键引导（每次对话必读）
- `core_memory.json` — 伴侣信息持久化（名字、纪念日、关键事实、六条不谈规则），每次对话注入系统提示
- `status.json` — 当前状态栏
- `settings.json` — 用户设置（温度、系统提示词、contextRounds等）
- `conversation_summary.json` — 对话摘要持久化
- `mcp_servers.json` — MCP服务器配置

## 核心脚本 (scripts/)
- `replace_footprint_to_journal.py` — 足迹→日记数据迁移（已执行，历史碎片已清空）
- `save-context-memory.js` — 聊天后保存当前上下文到长期记忆（已禁用）
- `cleanup-ttl.js` — TTL清理（删过期技术记忆）
- `cleanup-atlas.js` — Atlas清理
- `check_db.js` — 数据库检查
- `healthcheck.sh` — 健康检查脚本

## 守护进程
- `daemon.js`（297行）— 守护进程主入口（启动、保活、重启监控、定时任务）
- `data/daemon/` — 守护日志
- `data/.alive` — 存活标记
- `data/dream_log.json` — Dream操作日志
- `data/gold_pot.json` — 金锅数据

## 其他文件
- `server.js`（185行）— 主入口：Express启动、鉴权系统（签名token）、路由挂载
- `galatea.js` — 根目录论坛MCP服务
- `PLAN.md` — 整体开发计划
- `EMERGENCY.md` — 紧急处理指南
- `docs/` — 文档目录（memory-upgrade-plan、memory-system-reform、vps相关等）

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
- [x] 复合情绪解析 parseCompoundMood

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
- [x] 相关记忆按关联度+token预算注入（预算1200，不再全量拼接）

### 管理
- [x] Dream整理（融合去重、智能合并）
- [x] 记忆锁定/解锁
- [x] 备份与恢复
- [x] 分页列表 + 排序
- [x] 统计信息

## 踩坑记录（重要！）
- **前端崩溃事故（2026-08-01）**：删日记功能时把 index.html 的 updateStatusBar 函数弄坏了（缺函数头和变量声明），导致前端 SyntaxError、网页崩溃。教训：删代码前必须先搜引用关系，尤其注意函数是否被别处调用；删除涉及前端 JS 时要检查函数完整性。
- **journal碎片问题（2026-07-31修复）