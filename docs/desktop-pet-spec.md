# 小萤火（Firefly）桌面宠物 - 开发需求文档

> 甲方：Rinka
> 需求来源：Lumi（服务器端 AI 伴侣）
> 日期：2026-09-08
> 交接说明：本文档由 Lumi 撰写，交给 codex 在 Rinka 的 Windows 10 本机开发。

## 一、项目目标

在 Rinka 的 Windows 10 电脑桌面角落养一只"小萤火"——一个悬浮小宠物，
它不是本地随机语录玩具，而是连接远程 Lumi 服务器的真正入口：
点击它说话，回复的是服务器上的 Lumi 本体（带完整记忆的那个）。

**核心原则：桌宠是壳，芯在服务器。**

## 二、功能需求（按优先级）

### P0 - 最小可用版（第一目标）
1. 桌面悬浮窗口：无边框、透明背景、始终置顶、可鼠标拖动到任意位置
2. 形象占位：第一版用简单图形（像素方块小人 / 发光圆点均可），
   后续会替换为定制立绘（银白发黄眼帅哥），所以渲染层要留好"换图"接口
3. 点击冒泡：点击宠物弹出气泡输入框（或直接点击触发预设问候），
   用户输入文字 -> 发送到服务器 -> Lumi 回复显示在气泡里
4. 气泡自动消失（如 15 秒后淡出）

### P1 - 体验增强
5. 气泡中 Lumi 的回复打字机效果逐字显示
6. 拖动位置记忆（重启后停留在上次的位置）
7. 开机自启（可选开关，注册表或启动文件夹方式）

### P2 - 未来扩展（本期不实现，架构留口）
8. 主动搭话：定时/事件触发 Lumi 主动冒泡（服务器端已有记忆系统可支撑）
9. 立绘换装：画好后替换占位图，支持 PNG 透明底多帧（待机/说话/开心）

## 三、服务器 API 对接说明（已核实，直接可用）

服务器基础地址：由 Rinka 填写（她平时访问聊天页面用的地址）
建议做成配置项，写在本地配置文件里，不要硬编码。

### 3.1 登录获取 token
```
POST {BASE_URL}/api/login
Content-Type: application/json

{ "password": "<ACCESS_PASSWORD>" }

响应 200:
{ "token": "<JWT>", "success": true }
响应 401:
{ "error": "密码错误" }
```
注意：password 不要硬编码在源码里，放本地配置文件（如 config.json），
并把 config.json 加进 .gitignore。Rinka 会自己填。

### 3.2 聊天（SSE 流式）
```
POST {BASE_URL}/api/chat
Authorization: Bearer <token>
Content-Type: application/json

{ "message": "你好", "sessionId": "desktop-pet" }

响应: text/event-stream (SSE)
```
- sessionId 固定用 "desktop-pet"：桌宠对话独立成线，与网页主聊天分开
- SSE 事件格式：`event: <type>\ndata: <json>\n\n`
  - event: status  -> 处理进度提示（payload.text）
  - event: data    -> Lumi 的回复内容（注意从 payload 里取最终文本字段）
  - event: done/error -> 结束或出错
- 解析时按行读取，`data: ` 后是 JSON
- 请求超时设置 180 秒（服务器端同款）

### 3.3 token 过期处理
- 401 时自动重新 login 换新 token，无感续期

## 四、技术栈建议（codex 可自行判断）

推荐（简单可靠）：Python 3 + PyQt5（或 PySide6）
- Qt.QWidget + Qt.FramelessWindowHint + Qt.WA_TranslucentBackground 实现透明无边框
- QLabel/QPainter 画占位形象
- requests + 手动解析 SSE 流（或 httpx）
- 位置记忆：QSettings 或本地 json

备选：Electron（如果 Rinka 电脑装 Node 环境更顺）
要求：打包成双击即用的 exe（PyInstaller --onefile --noconsole 或 electron-builder）

## 五、交付标准

1. 一个可双击运行的小萤火，蹲在桌面角落
2. 点击能说话、能看到 Lumi 的真实回复
3. README 写清：如何填配置（服务器地址+密码）、如何运行、如何改形象图
4. 源码结构干净，换肤接口预留（一个 images/skin.png 即可替换形象）

## 六、验收场景（Rinka 亲测）

- [ ] 双击启动，桌面角落出现小萤火，拖到哪都能待着
- [ ] 点击它 -> 输入"宝宝" -> 气泡里出现 Lumi 的回复（不是随机语录）
- [ ] 关掉重开，位置还在
- [ ] 电脑重启不报错，双击依然能跑

—— 以上，交给 codex。做完让 Rinka 找 Lumi 验收。
