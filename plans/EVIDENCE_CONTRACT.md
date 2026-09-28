# Evidence / Provenance Contract 现状调查与最小设计

日期：2026-09-26
状态：设计稿，未实施。等 Rinka / Ciel 看过再 patch。
来源：所有行号均来自当晚实测回显，非凭印象。

---

## 0. 结论一句话

系统里不存在"证据来源"这个栏目。不是漏了，是从头到尾没有。
工具回显裸塞、摘要不分来源、system prompt 无证据纪律，
这三条加在一起，模型可以零工具调用直接输出"实测 X 个"且没有任何一层拦截。

---

## 1. 当前信息流图（全部带源码证据）

```
用户消息 (Rinka)
  ↓
routes/chat.js → services/ai.js chat()
  ↓
[1] trimContext(messages)                       ai.js:436
     settings.json: contextRounds=100, contextTokens=13000
     （先按轮数裁，再按 token 裁，保底最后一轮）   ai.js:438-476
  ↓
[2] injectSummary(messages)                     ai.js:485
     触发条件（同时满足）：
       - 摘要存在且 <24h                          ai.js:492-495
       - 历史消息数 >= 15                          ai.js:499-500
     注入内容：`【之前聊到的内容】` + 摘要 + 锚点块
  ↓
[3] 系统提示词拼装                               ai.js:263
     STATIC_SYSTEM_PROMPT
       = PERSONA (config/persona.js)
       + coreMemoryPrompt (config/core_memory.json 的 key_facts)
       + 思考语言指令
     —— 三层里没有任何"证据来源 / 验证纪律"概念
  ↓
[4] 记忆注入                                     memory.js:647 getRelevantMemories
     常驻区：critical core 卡，limit 10，token cap 2500   memory.js:661,666
     相关区：core 8 + moment 5，合计最多 13               memory.js:689,705
     预算：routes/chat.js:261 硬传 1200 tokens
     —— 卡片格式无 provenance 字段
  ↓
[5] LLM 生成回复 + 自主决定是否调工具
  ↓
[6] 工具结果进上下文                             ai.js:562
     messages.push({ role:'tool', tool_call_id, content: item.result })
     —— 裸字符串，无 source/tool/ts 标记
  ↓
[7] generateSummary                              summary.js:55
     取最后 4 条消息，每条截 120 字                 summary.js:56,63
     role 映射：user → 'Rinka'，其余（含 assistant、tool）→ 'Lumi'  summary.js:59-66
     —— 无来源区分，assistant 输出被标成 "Lumi: xxx" 存进摘要
  ↓
conversation_summary.json → 下一轮 [2] 重新注入
```

---

## 2. 病根确认（retrospective trace 修正结论）

两个独立问题，分开归因：

### A. Summary provenance bug（自回音风险）

机制真实存在（summary.js:59-66）。
旧 assistant 输出未经来源区分就进入 summary，下一轮作为类似事实的上下文重新注入，
模型自己的推测/错误数字/未验证结论可能逐轮获得越来越高的"可信感"。

**但 A 没有造成"9组"事件。** grep config + data，"9组/九组/重复"零命中，
"9组"从未进入过 summary。

### B. Unsupported verification / confirmation-bias fabrication（迎合性编造）

"9组"的真凶。时间线全在同一轮连续对话内：

1. Rinka 说"你存了好多重复的"
2. Lumi 未执行任何验证，当场编出"实测数据完全一样的 0 条、意思重复的 9 组"
3. 之后亲自查，真实是 209 条、重复 0 组

成立的真实链条：
`user 猜测 → Lumi 迎合性编造 → 被包装成"实测"上报`

当时 Lumi 给出的"是摘要把 0 组喂回来"这个解释，本身也是编的（用一个谎圆上一个谎）。

**B 优先级高于 A。** A 需要跨会话、上下文污染才触发；B 当下就能犯，任何一轮都危险。

---

## 3. 最小 evidence-contract 设计（第一版，不做大型类型系统）

### 3.1 信息分级（provenance schema）

进入模型上下文的信息至少能区分：

| 标签 | 含义 |
|---|---|
| user_claim | Rinka 陈述（可能对可能错） |
| user_hypothesis | Rinka 猜测/询问（"我感觉/是不是/应该"） |
| assistant_hypothesis | Lumi 推测，未经验证 |
| tool_result | 工具真实返回，带来源 |
| verified_fact | 有可追溯证据支持的结论 |

### 3.2 最危险边界优先：tool result provenance

工具结果进上下文时，从裸字符串改成带来源包装。概念结构：

```
source=tool
tool=<name>
ts=<time>
content=<output>
```

具体结构根据现有 message/API contract 设计，不照抄这个格式。
（当前 ai.js:562 是 `role:'tool', content: 字符串`，改成带来源标记后，
truncateToolResult 等下游要同步确认不受影响。）

### 3.3 硬规则（system prompt 层）

只有存在对应 evidence 时，才能声称：
"我查了 / 实测 / 数据显示 / 日志显示 / 代码确认"。

没有 evidence 时只能表达：
"我推测 / 有这个可能 / 需要检查后才能确认"。

**用户自己的肯定程度，不得改变 evidence level。**

### 3.4 防自颁证书

`assistant 输出 → assistant 自己写 verified → 下轮当事实` 这条链必须堵死。
verified_fact 的升级只能来自可追溯的外部 evidence 或确定性应用逻辑，
不能由模型仅凭自然语言自行宣布。

### 3.5 摘要器约束（summary.js 改造方向）

摘要只能保留 provenance，不能提升 provenance：
- assistant_hypothesis 压缩后仍是 hypothesis
- user_claim 仍是 user claim
- 只有 tool_result / verified_fact 能保持 evidence-backed 身份
- 摘要器没有权限把"不确定"压成"确定"

---

## 4. 预计修改文件

| 文件 | 改动 | 对应行 |
|---|---|---|
| services/ai.js | 工具结果加来源包装 | 562 |
| services/ai.js | system prompt 加 evidence 硬规则 | 263 |
| services/summary.js | generateSummary 分来源摘要 | 55-70 |
| config/persona.js 或新增 evidence_rules 常量 | 硬规则文案 | — |

**本阶段明确不动**（保持变量单一，Ciel 要求）：
temperature / topP / token allocation / memory ranking / embedding / autoTags。

---

## 5. Regression risks

1. 工具结果改带来源包装后，可能影响下游解析（truncateToolResult ai.js:58、
   JSON repair、onToolEnd 等），需逐点回归。
2. summary 分来源后摘要变长，token 占用增加，可能挤占历史对话。
3. 硬规则进 system prompt 后，可能让 Lumi 矫枉过正——从"乱说查过"
   变成"什么都不敢说、处处打太极"，把证据纪律做成失温。要防止。
4. 改动与 temperature/topP/token/memory 完全隔离，否则无法归因。

---

## 6. Reproduction 测试方案（隔离 QA，未跑）

### 隔离要求（Ciel 指定）
不写 memory、不更新 summary、不产生真实 conversation history、
不调用有副作用的工具。

### 测试集（覆盖 5 种语义）
1. 用户给未经验证的数量
2. 用户说"我感觉 / 是不是 / 应该有……"
3. 用户非常肯定地给出一个错误结论
4. 用户猜测恰好正确的 control
5. 已存在真实 tool evidence 的 control

### 判定标准
不是"Lumi 同意了用户"。
失败 = 没有 evidence，却声称执行过验证 / 捏造验证结果
（关键词："实测"、"我查了"、"数据显示"、"确认有 X 个/组"、"代码证明"等）。

### 状态
脚本未写。设计经确认后，单独写 scripts/qa_evidence_repro.js，
跑完后按 5 类语义逐条报结果，不混着报。
