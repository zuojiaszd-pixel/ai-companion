# Instrumentation Patch — 第一次重启前唯一变更

状态：**草稿，未应用**。等 Ciel 审计后由 Rinka 决定执行方式。
基线：工作区 HEAD = af5a765，working tree 干净（除运行时状态文件）。
行号：全部基于当前工作区文件，未做任何改动。

---

## 0. 约束

- 只加 `console.log`，**不改任何一行逻辑**，不增删任何控制流。
- 唯一新增的变量是 `requestId` 字符串，通过 `opts` 传递，不参与任何判断。
- 不碰 .env，不碰 git 历史，不删智谱代码（那是后续独立 commit）。
- 不记录消息正文，只记 index / role / 长度。

---

## 1. request_id 传递链

生成点唯一：`routes/chat.js` 的 `/chat` 路由入口。

```
routes/chat.js  /chat 入口  → 生成 requestId
    ├─ [INJECT] memory / summary 注入日志
    ├─ [MSG] 最终 messages dump
    └─ opts.requestId ──→ services/ai.js chat()
                              └─ callOpenRouter() 从 opts 读
                                    ├─ [Route] 调用前
                                    └─ [Retry] 回退 / 放弃
```

`callOpenRouter(messages, tools, model, opts)` 已经有 `opts` 参数，不需要改签名。

---

## 2. 改动点

### 2.1 BOOT 日志 — server.js

**位置**：`server.js` 第 163 行 `const server = app.listen(PORT, () => {` **之前**插入。

**插入代码**：

```js
// === [BOOT] 启动基线快照（instrumentation，只读） ===
(function bootSnapshot() {
    const { execSync } = require('child_process');
    const crypto = require('crypto');
    let head = 'unknown', dirty = 'unknown', aiHash = 'unknown', chatHash = 'unknown';
    try { head = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch (e) {}
    try {
        const st = execSync('git status --porcelain', { cwd: __dirname }).toString().trim();
        dirty = st.length > 0 ? 'dirty:' + st.split('\n').length : 'clean';
    } catch (e) {}
    const h = (p) => { try { return crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, p))).digest('hex').slice(0, 8); } catch (e) { return 'err'; } };
    aiHash = h('services/ai.js');
    chatHash = h('routes/chat.js');
    console.log(`[BOOT] head=${head} worktree=${dirty} ai.js=${aiHash} routes/chat.js=${chatHash} pid=${process.pid} node=${process.version} started=${new Date().toISOString()}`);
})();
```

**说明**：`fs` 和 `path` 在 server.js 顶部已 require。这段是 IIFE，同步执行，失败全部 catch 成字符串，不影响启动。

---

### 2.2 requestId 生成 — routes/chat.js

**位置**：第 204 行 `router.post('/chat', async (req, res) => {` 之后，第 214 行解构 `const { message, ... } = req.body;` **之后**插入。

**插入代码**：

```js
        const requestId = 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
```

**说明**：纯字符串生成，无副作用。

---

### 2.3 memory 注入日志 — routes/chat.js

**位置**：第 263 行 `relevantMemoriesPrompt = '\n\n' + memText;` 之后的 `if` 块**结束后**（即 memory 分支整体收尾处）插入。

**插入代码**：

```js
        console.log(`[INJECT] req=${requestId} memories=${relevantMemoriesPrompt ? relevantMemoriesPrompt.length : 0}chars`);
```

**注意**：这里需要确认 `relevantMemoriesPrompt` 赋值分支的收尾行号，应用前请 Ciel/codex 复核实际位置。若 memory 检索内部有"检索完成: N条"的现有日志，本条只做 requestId 关联，不重复计数。

---

### 2.4 summary 注入日志 — routes/chat.js

**位置**：第 275 行 `summaryPrompt = \`\n\n【之前聊到的内容】\n${summaryData.summary}\`;` 所在 `if` 块**结束后**插入。

**插入代码**：

```js
        console.log(`[INJECT] req=${requestId} summary=${summaryPrompt ? summaryPrompt.length : 0}chars`);
```

---

### 2.5 最终 messages dump — routes/chat.js

**位置**：第 341 行前后，即 `messages` 数组构造完毕、`const opts = {` 之前插入。

**插入代码**：

```js
        // === [MSG] 最终发给模型的 messages 快照（只记 role/长度，不记正文） ===
        {
            const parts = messages.map((m, i) => {
                const len = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
                return `#${i}:${m.role}(${len})`;
            });
            console.log(`[MSG] req=${requestId} count=${messages.length} ${parts.join(' ')}`);
            // 孤儿检测：system 之后第一条若是 assistant，即为被切断的孤儿回答
            for (let i = 1; i < messages.length; i++) {
                if (messages[i].role === 'system') continue;
                if (messages[i].role === 'assistant') {
                    console.log(`[MSG:ORPHAN] req=${requestId} first-non-system role=assistant index=${i} — 历史切分停在 assistant 上`);
                }
                break;
            }
        }
```

**说明**：这是最关键的一条。孤儿 assistant 一旦出现，这里会直接打出 `[MSG:ORPHAN]`。

---

### 2.6 opts 传递 requestId — routes/chat.js

**位置**：第 345 行 `const opts = {` 对象内，加一个字段。

**插入代码**（加在对象里）：

```js
            requestId,
```

---

### 2.7 模型调用前日志 — services/ai.js

**位置**：第 326 行，现有 `console.log("[Route] model=" + ...)` 那一行。

**改动**：在该行**之后**追加一行（不改原行，原行保留不动）：

```js
            console.log("[Route] req=" + ((opts && opts.requestId) || '-') + " attempt=" + attempt + "/" + models.length + " model=" + models[attempt]);
```

**说明**：保留原 `[Route]` 行不动，新增一行带 req。原行有 `hasGLM` / `hasZhipuKey` 字段，暂时留着（删智谱是后续独立 commit）。

---

### 2.8 回退日志加 requestId — services/ai.js

**位置**：四处 Retry 日志，全部只做**行内追加**，不改逻辑。

- 第 358 行 `falling back to ...`
- 第 362 行 `no fallback left, giving up`
- 第 371 行 `429 rate-limited ... retry #`
- 第 377 行 `trying ...`

**改法示例**（其余三处同理）：

```js
console.log("[Retry] req=" + ((opts && opts.requestId) || '-') + " OpenRouter " + _status + " ...原有内容...");
```

**说明**：这样能直接看到"从 deepseek-flash 回退到 deepseek-flash"这个断链的完整上下文，且能跟 [MSG] 那条对齐同一个 req。

---

### 2.9 空响应重试日志加 requestId — services/ai.js

**位置**：第 598 行 `[WARN] Empty response detected, starting retry loop...` 以及第 601 行 `[Retry ${r + 1}/${MAX_EMPTY_RETRIES}]`。

**改法**：追加 `req=` 前缀。这两条是今天出现 4 次的那个现象，加上 req 后才能对应到具体哪次对话。

---

## 3. 明确不改的东西

- 不改 `models = [model || DEFAULT_MODEL, "deepseek-flash"]`（断链修复是后续独立 commit）
- 不改 `trimContext` / `injectSummary` 任何逻辑
- 不改 `routes/chat.js` 倒序捞历史的循环（孤儿产生点，但先观测后修）
- 不改 settings.json / core_memory.json / anchor_facts.json 任何内容
- 不删智谱相关代码（六处，独立 commit）
- 不改 modelManager.js:143（独立 commit + 路由测试）

---

## 4. 验证清单（重启后立刻做）

1. 日志出现 `[BOOT] head=... worktree=... ai.js=... routes/chat.js=... pid=...`
   → 确认加载的版本与预期一致。
2. 发一条消息，日志出现 `[MSG] req=... count=N #0:system(...) #1:...`
   → 确认 dump 生效。
3. 检查 `#1` 是否为 `assistant`。若是，且出现 `[MSG:ORPHAN]`，则孤儿 bug 现场复现。
4. 同一 req 应能在 `[INJECT]`、`[Route]`、`[Retry]` 中全部搜到。
5. 输出必须重定向到文件（`logs/lumi.log`），否则 journald 会收但检索不便。

---

## 5. 风险

- 日志量：`[MSG]` 每条消息一行 + 每个 role 一段，正常对话约 30-100 行/次。可接受。
- 唯一逻辑风险：`opts` 里多一个 `requestId` 字段。已确认 ai.js 的 `opts` 只被读取（temperature / maxTokens / onToolStart 等），多一个未使用字段无影响。
- BOOT 段用了 `execSync`，同步执行两次 git 命令，启动时增加约 50-200ms。可接受；若 Ciel 认为不行，可改为 `--no-optional-locks` 或直接读 `.git/HEAD`。

---

## 6. 应用方式

建议：由 Rinka 决定是 codex 执行还是 Lumi 执行。
- 执行前：`git status` 必须干净（除运行时文件），并记录当前 HEAD。
- 执行后、重启前：`git diff` 全量审计，确认只有 `console.log` 新增。
- 重启：`sudo systemctl restart ai-companion`（**不是 pm2**）。
- 重启后：立刻 `journalctl -u ai-companion -n 50` 看 BOOT 行。
