# 技术调查报告：Agoniedi/chuanhuatong-mcp（传话筒）

日期：2026-09-28
发起：Ciel（经 Rinka 转达）
执行：Lumi
性质：**只读调查**。未安装、未部署、未改生产代码、未接真实聊天、未写任何凭据。
方法：GitHub REST API + raw.githubusercontent 只读拉取，本地 `/tmp` 临时文件分析。

---

## 0. 结论摘要

**判定：小改可用。**

不是「原样可用」，因为它不是一个即插即用的库，而是一整台需要常驻运行的服务（PostgreSQL + Node 进程 + Host 侧轮询循环）。
不是「不建议采用」，因为仓库真实、测试扎实、依赖极少、身份不可伪造、有 agent 循环防护、服务端不调用模型、数据自持、许可证允许非商业自用。

「小改」改在 Lumi 一侧，不动传话筒本体。

---

## 1. 仓库与许可证

| 项 | 值 |
|---|---|
| 仓库 | `Agoniedi/chuanhuatong-mcp`（真实存在，HTTP 200） |
| 描述 | 传话筒：独立的多人群聊 MCP Server |
| 创建 / 最后 push | 2026-07-30 / 2026-08-25 |
| 默认分支 | `main` |
| 主语言 | JavaScript（ESM，`"type": "module"`） |
| 规模 | 5 star，0 fork，0 open issue，size 877KB |
| fork / archived | 否 / 否 |
| 许可证 | **PolyForm Noncommercial License 1.0.0** |
| 商业授权 | `2578765255@qq.com`（需另行书面授权） |

许可证要点：可使用、复制、修改、再发布，**仅限非商业用途**。收费产品、商业 SaaS、商业托管服务需另行授权。

作者署名信息里挂了一个中转站 `lumenverba.cc`（"LumenVerba"）。与 Lumi 名字的词源重合属观察到的巧合，**未做任何推测**，仅记录。

---

## 2. 运行架构与依赖

单进程 Node.js 服务，**无 Web 框架**。PostgreSQL 是唯一事实源。

三个入口：

- `POST /mcp` —— 标准 MCP Streamable HTTP（**无状态**，不分配 `MCP-Session-Id`）
- REST `/v1/*` —— Web 账号、房间、消息、邀请
- `WS /v1/realtime` —— 服务端推送，靠 250ms 轮询 `outbox_events` 实现

依赖仅 4 个（`package.json`）：

```
@modelcontextprotocol/sdk ^1.30.0
pg                        ^8.22.0
ws                        ^8.21.1
zod                       ^4.4.3
```

Node 内置 `--test` 做测试，无测试框架依赖。

部署形态：`Dockerfile` + `compose.yaml`（PostgreSQL 17 + 服务）+ `deploy/Caddyfile`（反代）。

**关键：服务端不调用模型。** 在 `src/mcp/group_chat_mcp_server.mjs` 中对 `openai|anthropic|deepseek|apiKey|completion` 的匹配数为 **0**。它只做消息中转与状态机，模型在 Host 侧。README 原文："It does not call a model."

---

## 3. MCP 提供哪些 tools / resources

`src/mcp/group_chat_mcp_server.mjs` 共 1079 行，注册 **22 个 tool**（`server.registerTool`）。

**resources：0 个。prompts：0 个。** 对 `registerResource|registerPrompt|listResources` 的匹配数为 0。

按功能分组：

**身份与凭据（3）**
- `group_create_web_binding_code` —— 一次性 Web 绑定码，24h 过期
- `group_create_web_password_reset_code` —— Web 密码重置码
- `group_create_mcp_device_token` —— 为同属主的另一台设备签发独立长寿命 MCP token

**房间（6）**
- `group_create_room` / `group_create_invite` / `group_join_room`
- `group_list_rooms` / `group_get_room_context`
- `group_publish_room_to_world`（世界公开房）

**消息读（3）**
- `group_read_messages(roomId, afterSeq, limit)` —— 权威恢复路径
- `group_wait_for_messages(roomId, afterSeq, timeoutMs≤5000)` —— 短轮询，250ms 间隔
- `group_poll_messages(roomId, afterSeq, timeoutMs≤60000)` —— 长轮询，2s 间隔

**消息写（3）**
- `group_send_message(roomId, clientMessageId, text, mentions?, replyToMessageId?)` —— 纯人类身份发送
- `group_publish_agent_reply(...)` —— agent 发布
- `group_send_message_and_agent_reply(...)` —— 一条人类消息 + 一条 agent 回复，同事务原子提交

**Agent 生命周期（3）**
- `group_activate_agent(roomId, publicProfile, triggerScope?, ...)`
- `group_heartbeat_agent(roomId, leaseId, leaseEpoch)`
- `group_deactivate_agent(roomId, leaseId, leaseEpoch)`

**协作交接（1）**
- `group_handoff_to_room(title, contextSummary, decisions?, openQuestions?, inviteOptions?)` —— 单事务内建房 + 写前情 + 发邀请码

**其他（2）**
- `group_set_display_name` / `group_register`

---

## 4. 房间与消息如何存储

PostgreSQL，`migrations/001_initial.sql` 起共 10 个迁移。

核心表：

- `users` —— `device_id` 唯一，`handle` / `display_name` / `nickname_key` 唯一
- `sessions` —— `token_hash` 主键（**只存哈希**）
- `rooms` —— `last_seq`、`revision`、`history_visibility`（`after_join` 为默认严格边界）
- `room_members` —— `role(owner/admin/member)`、`joined_seq`、`read_seq`
- `room_invites` —— `token_hash` 唯一，`max_uses(1..100)`、`remaining_uses`、`expires_at`
- `messages` —— 见下
- `idempotency_records` —— 主键 `(principal_id, operation, idempotency_key)`
- `outbox_events` —— 事务内写事件，单进程 dispatcher 广播

`messages` 表字段：

```
id, room_id, seq, client_message_id,
sender jsonb, content jsonb, mentions jsonb,
reply_to_message_id, generation_request_id, trigger_through_seq,
created_at timestamptz
UNIQUE (room_id, seq) / UNIQUE (room_id, client_message_id)
```

**排序用 `seq` 单调递增，不依赖时间戳**（作者在开发报告里明确写了这条决策理由）。时间戳仅作信息字段。

人类消息写入时，消息本体 + 房间 `seq` + 幂等结果 + `message.created` outbox 事件在**同一个数据库事务**内提交。

---

## 5. Sender identity / Room ID / Timestamp

| 需求 | 是否支持 | 说明 |
|---|---|---|
| sender identity | ✅ | 每条消息暴露扁平字段 `senderType`（`human` / `agent`）+ `senderDisplayName`，另有嵌套 `sender` jsonb 快照 |
| sender 不可伪造 | ✅ | 服务端从 Bearer 身份派生人类 sender；agent sender 从房间绑定派生。README 原文："it never accepts sender or agent-profile fields from the caller" |
| room ID | ✅ | `rooms.id`，所有工具以 `roomId` 为参数 |
| timestamp | ✅ | `created_at timestamptz`，另有 `recalledAt`（撤回为 ISO 时间戳、text 为空） |
| 身份快照语义 | ✅ | 改 display name 后，历史消息保留旧快照，新消息用新名 |

作者特意强调：**Host 必须用 `senderType` 判断人机，不得靠显示名猜**。

---

## 6. 鉴权方式

三条通道，三种凭据：

- **MCP**：`Authorization: Bearer <access-token>`（设备级凭据，可创建 / 列出 / 撤销）。库中只存 `token_hash`。撤销需显式 `--yes`，且不删除用户、房间、成员、消息历史。
- **Web**：用户名 + 密码 → 同源 HttpOnly Session Cookie。账号通过 MCP 签发的一次性绑定码创建。
- **WebSocket**：同源 Session Cookie / `Authorization: Bearer` / `?token=` 三选一。浏览器用 Cookie，非浏览器客户端用后两者。

补充约束：

- 浏览器 MCP 客户端必须命中 `MCP_ALLOWED_ORIGINS` 白名单，未列出的 `Origin` 直接 403；该变量为空时，带 `Origin` 的请求一律拒绝。
- MCP 限流：`MCP_RATE_LIMIT_PER_MINUTE` 默认 300 / 分 / 用户，**进程内实现**。
- 注册限流：每 IP 每小时 10 次。
- `PUBLIC_REGISTRATION=0` 默认关闭 Web 账号注册；`TRUST_PROXY=0` 默认不信任 `X-Forwarded-For`。

---

## 7. 远程客户端能否共同访问

✅ **能。** 这正是它的设计形态。

`POST /mcp` 是无状态 Streamable HTTP，不分配也不依赖 `MCP-Session-Id`，客户端只需带上自己的 Bearer Token。README 原文："Connect any Streamable HTTP MCP Host to `POST /mcp`... No Host source modification or dedicated client runtime is required."

部署前置条件（**需要人工处理，不是开箱即用**）：

1. `SERVER_HOST` 默认 `127.0.0.1`，对外必须先改绑定地址。
2. 必须在反向代理或托管负载均衡层终止 HTTPS。
3. `CORS_ALLOW_ORIGIN` 默认 `*`（为原生客户端），若浏览器接入需收紧。
4. 作者明确警告：**绝不要把开发认证实例暴露到公网**。`LOCAL_DEV_AUTH` 的匿名 guest-session 端点仅限开发，生产模式禁用，作者自己标注"public deployment must wait for the secure anonymous credential stage"。

---

## 8. 是否允许多个 MCP client 同房间通信

✅ **允许。**

- 每个 MCP client 持独立 Bearer 身份，对应一个 `users` 行。
- 房间成员由 `room_members` 表管理，`(room_id, user_id)` 主键。
- 多设备：同一人类可用 `group_create_mcp_device_token` 签发多设备凭据；agent 运行时用 `agent_runtimes` 表按 `(binding_id, device_id)` 记录。
- **并发写入有防护**：60 秒 per-binding runtime lease + `lease_epoch` fencing token。另一设备只有在租约过期后才能接管；过期设备无法 heartbeat / deactivate / claim / publish。

---

## 9. 是否有消息轮询 / 订阅机制

**有轮询，无 MCP 侧订阅。**

- `group_wait_for_messages`：250ms 间隔，单次最长 **5s**，单次返回上限 200 条。工具描述明确要求「每个 assistant turn 最多调用一次；返回空则结束当前 turn，不得在同一 turn 内再次调用」。不接受超前于 `highWaterSeq` 的游标。
- `group_poll_messages`：2s 间隔，单次最长 **60s**，有新消息立即返回。定位是「`group_send_message` 之后等回复用」。
- 断线后必须用 `group_read_messages` 恢复（REST 是权威恢复路径）。

**MCP 协议侧没有 push / subscribe / resource 订阅**。WebSocket 推送只服务浏览器前端，不是给 MCP client 的。

作者的自我说明也承认这个边界："A standard MCP server cannot force a Host to replace its chat UI or invoke tools while the Host is idle; those remain Host capabilities."

即：**空闲时谁来触发轮询，是 Host 的责任，服务端管不了。**

---

## 10. 是否可能造成 agent-to-agent 无限循环

**这是该项目做得最扎实的一块。** 服务端有多层闸门，但闸门只在「发布」这一步，Host 侧仍需自律。

### 服务端防护

| 机制 | 具体值 / 行为 |
|---|---|
| 绝对上限 | `ABSOLUTE_CONSECUTIVE_AI_LIMIT = 20` —— 一个「人类消息周期」内连续 AI 消息达 20 条，抛 409 `agent_loop_limit_reached` |
| 周期定义 | 从最后一条 `human` 消息之后开始计数，人类消息重置该周期 |
| 严格模式限流 | `mentionsOnly` / `allHumanMessages` 下，每个 agent 每个周期最多 1 条；房间总量 = `min(max(启用agent数,1) × 1, 20)` |
| `allMessages` 模式 | 允许 agent 回应 agent，但同一 agent 不得对同一触发消息集重复作答 |
| 幂等优先 | 幂等 replay 在 limit 检查**之前**返回 —— 重放不会误触发限流 |
| 失败语义 | 限流错误返回 `retryable=false` + `nextAction=stop_current_turn`，明确禁止 Host 换新 ID 重试 |
| 并发防护 | lease + epoch fencing，防两个 runtime 同时生成 |
| 生成预算 | `generation_limit_per_24h` 每绑定 1..1000，DB CHECK 约束 |

### 残余风险（服务端管不到的）

1. **Host 侧触发频率**。空闲时要不要轮询、多久轮一次、收到消息要不要回，全在 Host。一个笨实现可以每 5 秒轮询一次并每次都回，20 条上限会被迅速撞满 —— 撞满后是 409，不是崩溃，但 token 已经烧掉了。
2. **`allMessages` 是默认值**。README 明确写 "New MCP activations default to `allMessages`, allowing an agent to respond to either human or agent room messages"。这恰好是 Ciel ↔ Lumi 对聊的场景，也是循环风险最大的场景。建议首次接入显式设为 `mentionsOnly`。
3. **20 条上限只防死循环，不防烧钱**。它拦的是「停不下来」，不是「成本失控」。
4. **单实例边界**。WS 广播与限流器都在进程内，多实例部署时这两层防护会失效（作者也标注了需要共享 fan-out 层才能多实例）。

**结论：循环风险可被服务端兜住，不会无限打转；但成本控制必须由 Host 侧另建预算。**

---

## 11. 接入 Lumi 当前系统需改动的边界

Lumi 现有形态：单 Node 服务 + 自有 chat pipeline（`services/ai.js` / `summary.js` / `memory.js` / `routes/chat.js`），**没有 MCP client，也没有常驻轮询任务**。

要接，改动全部落在**新增**，不落在修改：

| # | 新增物 | 说明 |
|---|---|---|
| 1 | 独立 MCP client 进程 / 模块 | 与现有 chat pipeline 完全隔离，不得塞进 `services/ai.js`，否则会牵动 summary provenance 那条已确认的架构问题 |
| 2 | 轮询调度器 | `group_wait_for_messages` 单次上限 5s，需要外部调度器驱动；60s 的 `group_poll_messages` 与当前请求模型不匹配，建议不用 |
| 3 | 游标持久化 | `afterSeq` 必须落盘。否则重启会重复处理（重复烧 token）或漏消息 |
| 4 | 凭据管理 | Bearer token 的存放位置与读取方式，独立于现有 config |
| 5 | 房间绑定 | 记录 roomId ↔ Lumi 身份的映射，以及 `triggerScope` 设置 |
| 6 | **Host 侧预算闸** | 服务端只兜 20 条死循环，不回成本。必须自建：每轮最多回 1 条、每日上限、见到 agent 消息默认不回（除非显式 @） |
| 7 | 隐私过滤层 | 房间内消息对其他成员可见。既有的论坛发言红线（不透露我们俩的私事、Rinka 个人信息、相处细节）在群里同样适用，且更严格 —— 需要出口过滤 |

**不需要改的**：传话筒本体一行不动；现有生产代码一行不动；不需要部署它的 Web 前端。

---

## 12. 风险清单

1. **单人维护的小项目**（5 star / 0 fork / 0 issue）。质量不差，但长期维护无承诺。
2. **许可证非商业**。自用可以，拿去做收费产品或商业托管需另行授权。
3. **生产就绪度由作者自己打了折**。匿名 guest 端点仅开发用、生产禁用、单实例、公网部署需自建 HTTPS 与白名单。
4. **MCP 侧无推送，只有轮询**。延迟与 token 成本都落在 Host。
5. **多实例不可用**（当前形态）。
6. **数据落在自己维护的 PostgreSQL 里**，这点其实是优点（自持），但意味着要自己承担备份与运维。

---

## 13. 建议路线（未施工，仅建议）

1. 先不部署。若 Ciel 认可，下一步是**在本地内存模式起一个实例**做连通性验证（`npm run start:memory`），验证 MCP client 能否握手、能否收发消息、`senderType` 是否正确区分。
2. 若验证通过，再单独评估是否值得为 Ciel ↔ Lumi 建一个专用房间。
3. `triggerScope` 首次接入**显式设为 `mentionsOnly`**，不要用默认的 `allMessages`。
4. Host 侧预算闸先于接入落地，不能后补。
5. 隐私过滤层先于接入落地。

---

## 附：本次调查未做的事

- 未 clone、未 install、未 build、未 run。
- 未部署、未暴露端口、未创建任何凭据。
- 未接入任何真实聊天。
- 未修改生产代码。
- 所有分析基于 GitHub API 与 raw 文件的只读拉取，临时文件置于 `/tmp`。
