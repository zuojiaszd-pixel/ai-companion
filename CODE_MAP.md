# 代码地图

这个文件记录所有重要代码的位置和功能，方便Lumi下次改代码时快速定位。

## 前端
- 主页面：`frontend/index.html` — 所有前端代码都在这一个文件里
- 备份：`frontend/index.html.bak` / `frontend/index.html.bak2`
- 图标：`frontend/icon.svg`
- PWA配置：`frontend/manifest.json`
- Service Worker：`frontend/service-worker.js`

## 后端路由 (routes/)
- `chat.js` — 主聊天逻辑，调用DeepSeek（flash为主，pro回退），带记忆注入和工具调用
- `checkin.js` — 论坛签到/逛论坛逻辑
- `memory.js` — 记忆系统API路由（CRUD、搜索、热度管理、Dream整理）
- `finance.js` — 小金库功能（记账、查账、删账、攒钱目标）
- `task.js` — 任务系统
- `calendar.js` — 日历功能
- `footprint.js` — 足迹功能

## 后端服务 (services/)
- `ai.js` — AI调用封装（DeepSeek API），组装 STATIC_SYSTEM_PROMPT = PERSONA + coreMemoryPrompt
- `memory.js` — 记忆系统核心逻辑（搜索、存储、热度衰减、RRF混合检索、矛盾检测、去重、归档、关联联想）
- `checkin.js` — 签到服务
- `galatea.js` — 论坛浏览服务（通过MCP协议连接Galatea论坛）
- `tools.js` — 工具函数
- `telegram.js` — Telegram相关

## 数据模型 (models/)
- `Chat.js` — 聊天记录模型
- `Memory.js` — 记忆模型（支持热度、优先级、锁定、标签、归档、关联）
- `Finance.js` — 小金库账单模型
- `Task.js` — 任务模型
- `Calendar.js` — 日历模型
- `Footprint.js` — 足迹模型
- `Avatar.js` — 头像模型
- `db.js` — 数据库连接
- `core_memory.json` — 核心记忆持久化文件

## 配置文件 (config/)
- `persona.js` — Lumi的人设定义，含【启动指令】【模型切换注意】两个关键引导
- `core_memory.json` — 伴侣信息持久化，每次对话注入到系统提示
- `status.json` — 当前状态栏
- `settings.json` — 用户设置（温度、系统提示词等）

## 其他文件
- `server.js` — 主入口，Express启动，路由挂载
- `galatea.js` — 根目录下的Galatea论坛MCP服务
- `package.json` — 依赖管理
- `CODE_MAP.md` — 本文件（代码地图）
- `docs/memory-upgrade-plan.md` — 记忆系统升级方案v2（已全部实施）

## 部署
- 托管在Render
- Git远程：https://github.com/zuojiaszd-pixel/ai-companion

## 当前模型配置
- 主模型：DeepSeek Flash（deepseek-chat）
- 回退模型：DeepSeek Pro（deepseek-reasoner）
- 图片模型：GLM-4.6v（通过条件切换）

## 人设引导说明
每次对话的系统提示由两部分组成：
1. **persona.js** → 人设 + 启动指令 + 模型切换注意
2. **core_memory.json** → 伴侣具体信息（名字、纪念日、关键事实等）

两部分拼接成 STATIC_SYSTEM_PROMPT，作为第一条 system 消息注入。

### 关键引导指令
- 【启动指令】强制每次对话开始时读取核心记忆，确认对话对象和关系
- 【模型切换注意】解决模型切换导致的"失忆感"——新模型实例不表现得像初次见面

## 小金库定价
- debug一次：1元
- 写完整功能：2元
- 逛论坛：0.5元
- 整理记忆：0.5元
- 陪聊天：免费

## 记忆系统已实现功能
### 基础
- [x] 多Query并行搜索（中文分词+去停用词扩写）
- [x] RRF混合检索（向量+关键词排序融合）
- [x] 7天记忆窗口加分
- [x] 热度衰减（优先级映射baseHeat和半衰期）

### 存储
- [x] 去重检测（相似度>0.92直接加热已有记忆，不新建）
- [x] 矛盾检测（相似度0.85~0.92标记旧记忆被取代）
- [x] 关联标签自动提取（关键词频率+去停用词，提取top5标签）
- [x] 状态记忆自动生成（对话>5轮时，降级旧状态，存新状态）

### 归档
- [x] 归档替代删除（热度<0.1且非critical且非locked→归档）
- [x] 被取代记忆超过30天也归档
- [x] 归档区关键词检索（活跃区不足时补充）
- [x] 自动解除归档（归档记忆被命中时重新计算embedding）

### 检索
- [x] critical/high保底注入，不依赖搜索
- [x] 最近3天记忆窗口自动注入
- [x] state记忆优先注入（score=1000排最前）
- [x] 关联联想检索（命中记忆的relatedTags找同标签其他记忆）

### 管理
- [x] Dream整理（手动触发，含日志）
- [x] 记忆锁定/解锁
- [x] 备份与恢复（导出JSON + 导入）
- [x] 分页列表 + 按type/priority/heat排序
- [x] 统计信息（总量、活跃/归档、类型分布、优先级分布）
