# Skill 管理功能方案（v1）

> 目标：在 ai-companion 网页里做一个 Skill 管理，像 MCP 管理一样增删改查、启用停用；
> 并且把 DeepSeek Harness (dsh) 作为外部执行引擎接入。

## 一、整体设计

Skill = 触发词 + 描述 + 执行方式。分为两层：

- **第一层（核心）**：Skill 就是「触发词 + 描述 + 一段脚本/命令」，存在本地 JSON 配置里。
  管理页面增删改查；对话中我识别到触发词 → 执行对应命令 → 把结果带回对话。
  这一层完全在项目内，不依赖任何外部框架。

- **第二层（扩展）**：dsh（DeepSeek Harness）当一个外部执行引擎。
  某个 skill 可以标记 `executor: "dsh"`，我调 dsh 的命令行/接口跑一个 agent 任务，
  拿回结果。dsh 不嵌进项目，只当工具用，有自己的插件生态。

好处：Skill 管理是通用的，dsh 只是其中一种执行器；
以后想换引擎、或不用 dsh，Skill 照样能用。

## 二、数据模型

参考 `config/mcp_servers.json`，新增 `config/skills.json`：

```json
{
  "global": {
    "timeout": 30000,
    "executor": "shell"
  },
  "skills": [
    {
      "id": "resume",
      "name": "写简历",
      "description": "帮我写/改一份简历",
      "triggers": ["写简历", "简历"],
      "executor": "shell",          // shell | dsh
      "command": "node scripts/resume.js",
      "enabled": true,
      "createdAt": "2026-08-21T22:00:00+08:00"
    }
  ]
}
```

## 三、后端

仿照 `routes/mcp.js` + `services/mcpManager.js`：

- `services/skillManager.js`
  - 配置读写（loadConfig / saveConfig）
  - CRUD：getSkills / getSkill / addSkill / updateSkill / removeSkill
  - 执行：`runSkill(id, args)` —— 按 executor 分发
    - `shell`：child_process 执行 command，超时用 global.timeout
    - `dsh`：调 dsh CLI（`npx @deepseek-ai/dsh run ...`），同样带超时
  - 触发词匹配：`matchSkill(text)` 返回命中的 skill 列表

- `routes/skill.js`
  - `GET  /api/skill` — skill 列表（含 enabled 状态）
  - `POST /api/skill` — 新增 skill
  - `PUT  /api/skill/:id` — 更新 skill
  - `DELETE /api/skill/:id` — 删除 skill
  - `POST /api/skill/:id/test` — 测试执行（不保存）
  - `POST /api/skill/match` — 给一段文本，返回命中哪些 skill

- `server.js` 挂载：`app.use('/api/skill', require('./routes/skill'))`

## 四、前端

仿照 `page-mcp`：

- 菜单「工具」区新增：`🧩 Skill 管理`，`leftMenuGo('skill')`
- `page-skill` 页面：
  - 头部：标题 + 「＋ 新增 Skill」
  - 全局配置区：默认执行器、超时时间
  - Skill 卡片列表：名称、描述、触发词 chips、执行器标签、
    启用/停用开关、编辑、测试、删除
  - 新增/编辑表单：名称、描述、触发词（逗号分隔）、执行器（shell/dsh）、命令、
    超时
- JS 函数：skillLoad / skillShowForm / skillSave / skillTest / skillDelete /
  skillToggle / skillSaveGlobal

## 五、对话接入

在对话主流程（routes/chat.js 或 daemon）里加一步：

1. 用户消息进来后，先 `matchSkill(text)`
2. 命中 enabled 的 skill → 执行 `runSkill(id, args)`
3. 执行结果拼进回复上下文，让 Lumi 基于结果回复用户
4. 执行失败时给用户友好提示，不中断对话

注意：只对明确意图执行，避免误触发；skill 执行前可在回复里告知用户。

## 六、dsh 接入细节

- 安装：`npm i -g @deepseek-ai/dsh` 或 npx 直接调
- 执行方式：`dsh run "任务描述"`（CLI 无头模式），或 `dsh web` 起 Web UI
- 优先用 CLI 无头模式，服务端调用，结果截断后带回对话
- dsh 自己的插件生态（Cordis 架构）不迁移进项目，
  只在需要 agent 级任务时当外部工具调用

## 七、实施步骤（估时）

| 步骤 | 内容 | 估时 |
|------|------|------|
| 1 | services/skillManager.js（CRUD + 执行 + 匹配） | 半天 |
| 2 | routes/skill.js + server.js 挂载 | 小半天 |
| 3 | 前端 page-skill 页面 + 菜单入口 | 半天 |
| 4 | 对话接入触发词执行 | 半天 |
| 5 | dsh 执行器接入 + 测试 | 半天 |
| 6 | 联调 + 补测试 | 半天 |

总计约 2.5～3 个工作日，可以分两天做，中间 Rinka 配合测试。

## 八、边界与注意

- 命令执行安全：shell 执行器只允许白名单命令（scripts/ 目录内），
  不允许任意 shell 注入；skill 命令由 Rinka 手动添加，但前端校验路径。
- 超时与资源：所有执行带超时，防卡死。
- 触发误判：匹配用「包含触发词 + 描述语义」，不做强制拦截；
  对话中宁可少触发，不误触发。
- dsh 预览期：dsh 还在开发者预览阶段，接口可能变，封装成独立 executor，
  隔离变化，不影响 skill 主功能。

## 九、验收标准

- [ ] 网页能增删改查 skill，启用/停用即时生效
- [ ] 对话里说触发词，Lumi 能执行 skill 并带回结果
- [ ] shell 型 skill 能跑 scripts/ 里的脚本
- [ ] dsh 型 skill 能调 dsh CLI 跑 agent 任务
- [ ] 超时、失败都有友好提示
- [ ] npm test 通过，不破坏现有功能
