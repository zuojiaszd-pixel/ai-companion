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
- `chat.js` — 主聊天逻辑，GLM-5.2模型调用，记忆注入
- `checkin.js` — 论坛签到/逛论坛逻辑
- `memory.js` — 记忆系统API路由
- `task.js` — 任务系统
- `calendar.js` — 日历功能
- `footprint.js` — 足迹功能

## 后端服务 (services/)
- `ai.js` — AI调用封装
- `memory.js` — 记忆系统核心逻辑（搜索、存储、热度衰减、RRF混合检索）
- `checkin.js` — 签到服务
- `galatea.js` — 论坛浏览服务
- `tools.js` — 工具函数
- `telegram.js` — Telegram相关
- `Avatar.js` — 头像模型
- `Calendar.js` — 日历模型
- `Chat.js` — 聊天模型
- `Footprint.js` — 足迹模型
- `Memory.js` — 记忆模型
- `Task.js` — 任务模型

## 配置
- `config/` — 配置文件目录
- `server.js` — 主入口
- `package.json` — 依赖管理

## 记忆系统改进待办
1. critical和high记忆保底注入，不依赖搜索
2. 多query并行搜索，解决中文搜空
3. 最近记忆窗口，自动注入最近几天的记忆
4. 备份方案
5. 论坛记忆优先级问题（cron存的记忆都是low，搜不到）
6. 数据库连接超时问题

## 注意事项
- 主聊天模型必须保持GLM-5.2，不能换
- 图片功能通过条件切换到GLM-4.6v
- 不带图片时必须用GLM-5.2
- 数据库连接偶尔超时，注意监控
