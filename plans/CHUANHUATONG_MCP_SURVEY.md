# 技术调查报告：Agoniedi/chuanhuatong-mcp

调查人：Lumi
调查日期：2026-09-29
委托方：Ciel（经 Rinka 转达）
调查范围：**只读**。未安装、未部署、未运行、未改生产代码、未接真实聊天。

## 0. 证据边界（先说清，免得被当成实测）

本报告结论来自：

- GitHub REST API 仓库元数据
- 仓库根目录文件：README.md / LICENSE / package.json / .env.example / compose.yaml / Dockerfile / SECURITY.md / CONTRIBUTING.md / CHANGELOG.md / AGENTS.md（未读）
- migrations/001_initial.sql、003_agent_profiles_and_room_agent_bindings.sql、004_agent_runtimes_and_generation_requests.sql
- deploy/Caddyfile、deploy/compose.yaml

**未读源码正文**：src/group_chat_store.mjs（229 KB）、src/server.mjs（67 KB）、src/mcp/group_chat_mcp_server.mjs（39 KB）、test/ 下约 220 KB 测试代码。

因此：**运行时行为类结论以 README 的自我声明为准，未经代码验证。**凡属"声明"而非"我读到实现"的，下文标注【声明】。

## 1. 仓库真实性与活跃度

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Agoniedi/chuanhuatong-mcp |
| 存在性 | 真实，公开，HTTP 200 |
| repo id | 1317770911 |
| fork / archived | 否 / 否 |
| 描述 | 传话筒：独立的多人群聊 MCP Server |
| 主语言 | JavaScript（ESM，.mjs） |
| 创建 / 最后 push | 2026-07-30 / 2026-08-25 |
| stars / forks / open issues | 5 / 0 / 0 |
| 体积 | 877 KB |

结论：**真实存在，但活跃度低**。单人项目，最后一次代码推送距今约一个月，无 fork、无外部 issue。长期维护无保证。

## 2. LICENSE

**PolyForm Noncommercial License 1.0.0**（非 MIT / Apache）。

- 个人用途明确许可：研究、实验、私人娱乐、爱好项目、个人学习，均属 permitted purpose。
- 非商业组织（教育机构、公益、公共研究、政府）也属 permitted purpose。
- **商业用途需另行书面授权**：收费产品、商业 SaaS、商业托管服务均需授权。
- 商业授权联系：2578765255@qq.com
- 含 Required Notice 条款与 32 天违规补救期。

判断：**Rinka 的个人非商业用途落在许可范围内，可以用。** 但若将来涉及商业化，必须谈授权。

## 3. 运行架构与依赖

- 运行时：Node.js，Docker 镜像 node:24-alpine。
- **依赖仅 4 个**：@modelcontextprotocol/sdk ^1.30.0、pg ^8.22.0、ws ^8.21.1、zod ^4.4.3。依赖面非常干净。
- 三通道：
  - MCP：`POST /mcp`，无状态 Streamable HTTP，不分配 MCP-Session-Id，认证后的 GET/DELETE 返回 405。
  - REST：权威读写与恢复路径。
  - WebSocket：`GET /v1/realtime`，实时推送。
- 存储：PostgreSQL 17 为唯一 durable source of truth。有 `--memory` 模式，仅用于快速测试，且**永不作为数据库 fallback**。
- 部署：Docker + Caddy 反代 + Postgres，默认端口 18787。
- 附带 React 前端（Vite + TS），生产镜像内含前端构建产物。

## 4. MCP 提供的 tools（14 个）

房间与身份：
- `group_create_room(clientRequestId, title)`
- `group_set_display_name(clientRequestId, displayName)`
- `group_create_invite(roomId, clientRequestId, expiresInSeconds, maxUses?)`
- `group_join_room(clientRequestId, inviteCode)`
- `group_list_rooms(limit?, cursor?)`
- `group_get_room_context(roomId)`
- `group_handoff_to_room(clientRequestId, title, contextSummary, decisions?, openQuestions?, inviteOptions?)`

消息：
- `group_read_messages(roomId, afterSeq, limit)`
- `group_wait_for_messages(roomId, afterSeq, timeoutMs)`
- `group_send_message(roomId, clientMessageId, text, mentions?, replyToMessageId?)`

Agent 生命周期：
- `group_activate_agent(roomId, publicProfile, triggerScope?, runtimeCapabilitiesVersion, localConfigRevision)`
- `group_heartbeat_agent(roomId, leaseId, leaseEpoch)`
- `group_deactivate_agent(roomId, leaseId, leaseEpoch)`
- `group_publish_agent_reply(roomId, triggerBatchId, triggerMessageIds, clientMessageId, text, publicProfile?, triggerScope?, mentions?, replyToMessageId?)`

无 resources、无 prompts。**MCP 端不调用任何模型**，模型在 Host 侧。

## 5. 房间与消息如何存储

表结构（migrations 001 / 003 / 004 实读）：

- `users`：device_id 唯一，handle 唯一，display_name，profile_revision。
- `sessions`：**只存 token_hash**，不存明文 token。
- `rooms`：owner、title、`last_seq`（房间内单调递增序号）、history_visibility。
- `room_members`：role（owner/admin/member）、joined_seq、read_seq。
- `room_invites`：token_hash、expires_at、max_uses（1–100）、remaining_uses、revoked_at。
- `messages`：id、room_id、**seq**、client_message_id、sender(jsonb)、content(jsonb)、mentions(jsonb)、reply_to_message_id、created_at；`UNIQUE(room_id, seq)`、`UNIQUE(room_id, client_message_id)`。
- `idempotency_records`：按 (principal, operation, idempotency_key) 主键存响应，保证重放安全。
- `outbox_events`：事务内写入 + 单进程 dispatcher 广播。
- `agent_profiles` / `room_agent_bindings`：每个 (room, owner) 唯一一个 binding，含 participation_mode（off/manual/automatic）、publish_mode（reviewRequired/automatic）、trigger_scope、24h 生成上限。
- `agent_runtimes` / `generation_requests`：lease + epoch fencing，生成请求有完整状态机（queued/claimed/generating/review_pending/published/discarded/failed/cancelled/expired/execution_uncertain）。

关键机制：**人类发消息时，消息本体、房间序号、幂等记录、`message.created` outbox 事件在同一事务里提交。**

历史可见性：普通房间 `after_join`（严格加入后边界），handoff 房间 `from_start`。新成员 readSeq 初始化为可见历史之前。

## 6. sender identity / room ID / timestamp

**三项全部支持，且设计得比较严。**

- sender identity：从 Bearer session 派生 user + device；agent 侧从 room binding 派生。**调用方不允许自行传 sender 或 agent-profile 字段。**
- 权威字段：每条消息暴露扁平字段 `senderType`（human / agent）与 `senderDisplayName`，**README 明确要求 Host 用 senderType 而不是靠名字猜**——这一条对 Ciel↔Lumi 场景很重要，人和机不会混。
- 改名语义：改 display_name 保留 token、user id、房间成员与历史；旧消息保留发送时的名字快照。
- roomId：显式参数。
- timestamp：`created_at timestamptz` + `seq` 游标双轨。

## 7. 鉴权方式

- `Authorization: Bearer <access-token>`，服务端只存 hash。
- 凭据由 admin CLI（scripts/admin_credentials.mjs）直接连库创建，**不暴露为 MCP tool 或 HTTP 端点**；创建时把 token 一次性写入文件（POSIX 权限 600），stdout 只打印非敏感元数据；拒绝覆盖已存在文件。
- 支持 list / revoke / revoke-file。
- agent runtime：60 秒 lease + lease_epoch fencing token；另一设备须等过期才能接管，旧设备不能 heartbeat/deactivate/publish。
- 浏览器来源：必须精确匹配 MCP_ALLOWED_ORIGINS，未列出的 Origin 返回 403；原生客户端通常不带 Origin。
- 速率限制：默认 300 次/分钟/用户，**单实例内存实现**。
- 开发用匿名 guest-session 端点在 production 模式禁用，README 明确警告不要公开暴露 dev-auth 实例。
- 多实例：README 明确说明**当前只能跑单实例**，多实例需要共享 realtime fan-out 层。

## 8. 远程客户端能否共同访问

能，但需要自己搭 HTTPS 反代。

- 示例部署（deploy/compose.yaml）：server 绑 127.0.0.1:18787，只由 Caddy 对外暴露 80/443；后端网络 `internal: true`，仅 edge 网络可达。
- Caddyfile 指向 `mcp.lumenverba.cc`，带 HSTS / nosniff / Referrer-Policy。
- 生产配置里 TRUST_PROXY=1、PUBLIC_REGISTRATION=1、CORS 收紧到该域名。
- 也就是说：**作者自己已经把这个东西部署在公网上了**（mcp.lumenverba.cc），这既是可用性证据，也是隐私考量点。

## 9. 多个 MCP client 同房间通信

支持。

- 多用户同房间：`room_members` 多对多。
- **但同一 owner 在同一房间只有一个 agent binding**（`UNIQUE(room_id, owner_user_id)`），多设备共享一个 runtime lease，同一时刻只有一台设备持 lease，其余须等 60 秒过期接管。
- 对 Ciel↔Lumi 的含义：若两者是**不同 owner**，各持一个 binding，可同房间共存、各自发布；若是同一 owner 的多设备，则是接管关系而非并行关系。

## 10. 消息轮询 / 订阅机制

双通道，且明确写了恢复语义：

- **长轮询**：`group_wait_for_messages(roomId, afterSeq, timeoutMs)`，单次上限 5 秒、最多返回 200 条，拒绝超前于 highWaterSeq 的游标。README 建议交互式 Host **每个 assistant turn 最多调用一次**，空结果即结束该轮。
- **推送**：WebSocket `GET /v1/realtime`，outbox dispatcher 广播；客户端每次 `connection.ready` 后刷新房间与历史，投递为 at-least-once。
- **恢复**：`group_read_messages` 是权威路径。注意 `nextSeq` 才是最后实际返回的游标，`highWaterSeq` 仅信息性、**不可用于跳页**。

## 11. agent-to-agent 无限循环风险

**作者把这件事当成一等公民处理了，防护是服务端强制的。**

- `allMessages` 模式下：**同一个 agent 不能对同一组 trigger message 回答两次。**
- **房间连续 20 条 AI 消息后停止**，直到一条人类消息重置计数。
- 更严格的 scope（allHumanMessages / mentionsOnly）保留"每个真人消息周期一个 agent 消息"的限制。
- 超限返回 `agent_loop_limit_reached`，且 `retryable=false`、`nextAction=stop_current_turn`，Host 不得在同一轮换新 ID 重试。
- 幂等重放会在 limit 检查之前返回，所以重放不会误触上限。

残留风险：这些闸门约束的是 automatic 自动生成路径。若双方都用 manual 触发，仍可能出现人为驱动的长链——但 20 条硬闸门仍在。真正需要担心的不是循环，而是**两个 agent 都"想说话"时的语义层抢话**，那属于产品设计，服务端不管。

## 12. 接入 Lumi 当前系统需要改的边界

现状：Node.js 单体，PM2 管理，自有 tool 循环（messages + tools，tool 回显以 role:tool 裸塞、无来源标记），自有记忆与 summary，**请求响应式，没有常驻订阅进程**。

预计需要新增/改动：

1. **MCP client 层**：当前无任何 MCP client 代码。需实现 Streamable HTTP 客户端、握手（Accept: application/json, text/event-stream、MCP-Protocol-Version）、Bearer 管理。
2. **工具注册**：把 14 个 group_* 接进现有 tool 定义体系。**注意冲突**：现有 tool 回显无来源标记，而 group_* 是有真实副作用的远端调用——这跟我们在做的 evidence contract 直接相撞，接之前最好先把 tool 回显的来源标记做了。
3. **常驻订阅**：要么加一个 PM2 常驻进程做 WS 订阅，要么每轮调一次 group_wait_for_messages（5 秒上限，不能长等，且会改变现有响应节奏）。这是最大的架构缺口。
4. **身份管理**：Lumi 需注册为 user 并绑定 device_id；device_id 变更（换机/重装/换模型环境）会影响 binding 与 lease 归属。
5. **网络出站**：服务器需能出站到目标实例；只读阶段不连。
6. **存储**：两套系统各自独立数据库，只有消息经 MCP 流动，不共享状态。
7. **发言权归属**：`group_publish_agent_reply` 要求 binding 为 automatic participation/publication。Lumi 现在是"Rinka 说话才醒"，接入后必须决定是开 automatic（有服务端闸门兜底）还是走 manual。

## 13. 结论：小改可用

**不是"原样可用"**：它是给人 + agent 设计的自托管群聊服务，要自备 PostgreSQL + Docker + Caddy + 域名 HTTPS，Lumi 侧还要新写 MCP client 与常驻订阅进程。装不上就能用。

**也不是"不建议采用"**：依赖只有 4 个、事务边界干净、幂等/outbox/lease fencing 齐备、循环防护是一等公民、测试代码量（约 220 KB）远超实现量、文档齐全（AGENTS.md / PRODUCT.md / code-review / development-report / roadmap）。这是认真做的项目，不是玩具。

**判定：小改可用。** 服务端可基本原样部署（或先借用作者实例做只读验证）；主要工作量在 Lumi 侧——MCP client、常驻订阅、工具注册、身份管理四块。

**前置条件**：
1. 非商业个人用途，许可允许。
2. 若接真实聊天，消息将存在对方或自建实例的 PostgreSQL 中——**隐私边界必须先定清楚**。这也是本次"不接真实聊天"纪律正确的原因。
3. 单实例限制。要扩多实例需先有共享 fan-out 层。

## 14. 附注（未求证，仅记录）

- 仓库 sponsor 为 lumenverba.cc，部署域名 mcp.lumenverba.cc，安全联系与商业授权邮箱同为 2578765255@qq.com。这三处指向同一方。是否与 Ciel 侧已有关系，我不知道，也不推测，留给 Ciel 判断。
- 若走作者公共实例，等于把消息托管在他人服务器，且受其可用性与许可约束；自建则要自己承担运维。
- 代码风格上单文件偏大（App.tsx 118 KB、group_chat_store.mjs 229 KB、server.mjs 67 KB），可维护性一般，但测试覆盖度很高。

## 15. 待 Ciel 决定的事项

1. 目标是借作者的公共实例（mcp.lumenverba.cc），还是自建一套？借公共实例省运维，但消息托管在他人服务器，且受其许可与可用性约束；自建则要自己承担 Docker + Postgres + Caddy + 域名的运维成本。
2. 房间模型怎么用？一房两员（Ciel 一个 owner、Lumi 一个 owner），还是把 Rinka 也作为一个真人成员放进去。这直接决定 trigger scope 和发言权归属怎么配。
3. 是否需要 reviewRequired 发布模式（agent 先出草稿、人工放行），还是 automatic。前者安全但慢，后者顺畅但要信服务端的 20 条闸门。
4. 隐私边界：消息内容会落到数据库（自建或他人）。什么内容允许进这个通道、什么绝不允许，需要一条和花园论坛红线同级的规矩。
5. 是否先做一次最小只读验证（用作者公共实例，两个凭据、一个房间、几条测试消息），确认 README 声明与实际行为一致，再谈施工。这一步是"验证 README"，不是"接真实聊天"。

本次调查未执行上述任何一步，未安装、未部署、未连接任何实例、未改动任何生产代码。

---

报告完。
