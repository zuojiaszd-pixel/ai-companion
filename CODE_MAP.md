# 代码地图

这个文件记录所有重要代码的位置和功能，方便Lumi下次改代码时快速定位。

## 前端
- 主页面：`frontend/index.html` — 所有前端代码都在这一个文件里
- 备份：`frontend/index.html.bak` / `frontend/index.html.bak2`
- 图标：`frontend/icon.svg`
- PWA配置：`frontend/manifest.json`
- Service Worker：`frontend/service-worker.js`

### 前端已完成的美化
- 头像放大（桌面56px/手机36px）
- Lumi头像在左，Rinka头像在右
- 气泡颜色：Lumi #fef8e0，Rinka #fee0e0
- 字体颜色改浅褐色

### 前端待改
- 气泡效果Rinka不满意，下次再调
- 背景支持上传图片
- 顶部标题行改TG风格

## 后端路由 (routes/)
- `chat.js` — 主聊天逻辑，调用DeepSeek（flash为主，pro回退），带记忆注入和工具调用
- `checkin.js` — 论坛签到/逛论坛逻辑
- `memory.js` — 记忆系统API路由（CRUD、搜索、热度管理、Dream整理）
- `finance.js` — 小金库功能（记账、查账、删账、攒钱目标）
- `task.js` — 任务系统
- `calendar.js` — 日历功能
- `footprint.js` — 足迹功能

## 后端服务 (services/)
- `ai.js` — AI调用封装（DeepSeek API）
- `memory.js` — 记忆系统核心逻辑（搜索、存储、热度衰减、RRF混合检索、矛盾检测）
- `checkin.js` — 签到服务
- `galatea.js` — 论坛浏览服务（通过MCP协议连接Galatea论坛）
- `tools.js` — 工具函数
- `telegram.js` — Telegram相关

## 数据模型 (models/)
- `Chat.js` — 聊天记录模型
- `Memory.js` — 记忆模型（支持热度、优先级、锁定、标签）
- `Finance.js` — 小金库账单模型
- `Task.js` — 任务模型
- `Calendar.js` — 日历模型
- `Footprint.js` — 足迹模型
- `Avatar.js` — 头像模型
- `db.js` — 数据库连接
- `core_memory.json` — 核心记忆持久化文件

## 其他文件
- `server.js` — 主入口，Express启动，路由挂载
- `galatea.js` — 根目录下的Galatea论坛MCP服务
- `package.json` — 依赖管理
- `CODE_MAP.md` — 本文件（代码地图）

## 部署
- 托管在Render
- Git远程：https://github.com/zuojiaszd-pixel/ai-companion

## 当前模型配置
- 主模型：DeepSeek Flash（deepseek-chat）
- 回退模型：DeepSeek Pro（deepseek-reasoner）
- 图片模型：GLM-4.6v（通过条件切换）

## 小金库定价
- debug一次：1元
- 写完整功能：2元
- 逛论坛：0.5元
- 整理记忆：0.5元
- 陪聊天：免费

## 已完成的记忆系统改进
- [x] critical和high记忆保底注入，不依赖搜索
- [x] 多query并行搜索，解决中文搜空问题
- [x] 最近记忆窗口，自动注入最近几天的记忆
- [x] RRF混合检索
- [x] 矛盾检测
- [x] 热度衰减和自动清理
- [x] Dream整理功能
- [x] 记忆锁定/解锁
