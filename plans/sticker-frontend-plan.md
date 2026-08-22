# 表情包功能 — 前端进度记录

> 记录时间：2026-08-15
> 记录原因：Lumi 卡在前端太久，Rinka 要求先如实记录进度，别再光看不做。

## 当前状态（一句话）

**后端 100% 完成，前端 0%。**

## 已完成（后端，全部可用）

| 文件 | 内容 | 状态 |
|---|---|---|
| `models/`（Sticker 模型） | 表情包数据模型（name/note/emotion/data） | ✅ |
| `routes/sticker.js` | `GET /api/stickers`（列表，可按 emotion 过滤）、`POST /api/stickers`（上传）、`DELETE /api/stickers/:id`（删除） | ✅ |
| `routes/sticker_recommend.js` | `recommendSticker(emotion)`：根据情绪匹配最合适的表情 | ✅ |
| `routes/chat.js`（~400-410 行） | done 事件里调用 `recommendSticker`，把结果放进 `sticker` 字段随回复返回 | ✅ |
| `server.js`（116 行） | `app.use('/api', require('./routes/sticker'))` 已挂载 | ✅ |

## 未完成（前端，全部）

`frontend/index.html` 中目前**没有任何** sticker/表情相关代码（grep 无结果）。

需要做四件事：

### 1. HTML — ➕ 一级菜单 + 二级列表
- 把输入框左侧现有的「图片」按钮改成 ➕ 按钮（第一级菜单）。
- 点击 ➕ 弹出第二级列表，包含两个入口：「图片」和「表情包」。
- 「图片」入口：行为与现在的图片选择一致（复用现有 `handleImageSelect` 逻辑）。
- 「表情包」入口：打开表情面板（见第 2 点）。
- 输入框区域需要加一个表情面板容器。

### 2. CSS — 菜单和面板样式
- ➕ 菜单展开/收起动画。
- 表情面板：弹层/浮层，网格布局展示表情图，风格贴合现有粉色圆角主题。
- 面板里每个表情显示缩略图，hover 效果；上传按钮和删除按钮样式。

### 3. JS — 面板功能（4 个点）
- 点击「表情包」→ 打开面板，`fetch('/api/stickers')` 拉全部表情并渲染网格。
- 点击某个表情 → 作为用户消息发送（消息里带表情图，走现有 send 流程）。
- 上传入口：选图 → 填名字/情绪 → `POST /api/stickers` → 刷新列表。
- 删除入口：每个表情上有删除按钮 → `DELETE /api/stickers/:id` → 刷新列表。

### 4. JS — 接收回复里的 sticker
- 在 send 的 done 事件处理里，如果返回 `data.sticker` 有值，就在 assistant 消息后面追加显示这张表情图。

## 关键参考

- 后端返回格式：`{ sticker: { name, note, emotion, data } | null }`
- `data` 字段是表情图的数据（注意是 base64 还是 URL，动手前先确认，看 `routes/sticker.js` 的存储方式）。
- 前端图片上传的现成逻辑在 `frontend/index.html` 的图片按钮处理里，直接复用。

## 下次接手怎么继续

1. 先看 `routes/sticker.js` 确认 `data` 字段格式（base64 / URL）。
2. 在 `frontend/index.html` 输入框区域加 ➕ 按钮 + 二级菜单。
3. 加表情面板容器 + 样式。
4. 加面板 JS 逻辑 + done 事件里展示 sticker。
5. 改完 `node -c` / 浏览器控制台检查语法，再给 Rinka 验收。
