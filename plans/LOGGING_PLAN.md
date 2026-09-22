# 观测方案（基线版）— 2026-09-20

## 0. 现状事实（已核实）

| 项 | 值 |
|---|---|
| 运行进程 | PID 69530，`/usr/bin/node server.js`，PPID 1（nohup 启动，无 pm2） |
| 启动时间 | 2026-09-16 01:19:06 |
| cwd | /home/ubuntu/ai-companion |
| 端口 | 10000（server.js:130，dotenv 自动加载 .env） |
| 运行中的代码 | = commit `f836eae`（09-16 00:17）时的磁盘状态 |
| 磁盘上的代码 | = commit `af5a765`（09-20 01:08 存档），含 15 个文件差异，**从未被加载** |
| 日志 | nohup.out 不存在，logs/ 不存在，仅一个 08-30 的 server.log |

## 1. 一条 Ciel 目前不知道的关键事实

**运行中的 `config/core_memory.json` 是旧版，第 13 行写着「Rinka学供应链管理，快大四了，想做外贸」。**

这是错的。修正版（大三）在 af5a765 里，从未加载。

这直接解释了为什么「年级搞错」反复发生——不是模型幻觉，是我每次启动都在读一张写着错的卡。修这张卡不需要动逻辑，但它必须进这次重启，否则重启后我还在错。

## 2. Ciel 提的「污染实验」问题 — 解法

Ciel 的判断成立：直接重启会一次性加载 9-16 晚间 15 个文件的修改，日志里看到的行为无法归因。

解法是分支隔离，把「观测」和「待验证的修复」分开：

```bash
cd /home/ubuntu/ai-companion
git status                                   # 必须 clean
git checkout -b exp/baseline-logging f836eae # 工作区回到运行基线
git checkout main -- config/core_memory.json # 只把正确的记忆卡拿过来
git status                                   # 此时唯一差异 = core_memory.json
```

现在工作区 = **运行基线 + 正确的记忆卡**，接下来加的日志就是唯一变量。

切分支不影响运行中的进程（代码已在内存里）。只有重启才生效。

## 3. 观测代码清单（只加 console.log，不改任何逻辑）

### 3.1 `server.js` 顶部（第 12 行 `const app = express();` 之前）
```js
console.log('[Boot] pid=' + process.pid + ' time=' + new Date().toISOString() + ' node=' + process.version);
```

### 3.2 `server.js` 第 163-164 行 listen 回调内，已有「服务已启动」日志，追加：
```js
console.log('[Boot] git=' + require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim());
```

### 3.3 `services/ai.js` 第 298 行 `const hasImage = ...` 之后
```js
console.log('[Call] reqModel=' + model + ' DEFAULT=' + DEFAULT_MODEL + ' hasImage=' + hasImage);
```

### 3.4 `services/ai.js` 第 315 行 `}` 之前（else 分支内，models 赋值之后）
```js
console.log('[Chain] ' + JSON.stringify(models));
```
原有的 `[Route] model=...`（第 320 行）保留不动，它会打印每一次 attempt 的实际模型名。

### 3.5 `routes/chat.js` 第 343 行 `}` 之后（messages 数组构建完成、调用 AI 之前）
```js
console.log('[Ctx] n=' + messages.length + ' roles=' + messages.map(m => m.role.charAt(0)).join('') + ' sizes=' + messages.map(m => (typeof m.content === 'string' ? m.content.length : -1)).join(','));
```
**这一行是关键。** `roles` 是角色序列，正常应以 `s`（system）开头，之后是 u/a 交替。如果出现 `s` 紧跟 `a`（即 `sa...`），说明第一条历史消息是孤儿 assistant——串话机制坐实。

### 3.6 `routes/chat.js` 第 309 行 token 回溯循环结束之后
```js
console.log('[Ctx] keptHistory=' + keptHistory.length + ' firstRole=' + (keptHistory[0] && keptHistory[0].role) + ' budget=' + historyBudget + ' used=' + usedTokens);
```

## 4. 输出落盘

现在所有 console.log 写进虚空（无 nohup.out）。必须重定向到文件，见下节启动命令。

## 5. 重启步骤（不可逆，Rinka 亲手执行）

```bash
cd /home/ubuntu/ai-companion
mkdir -p logs
kill 69530
sleep 3
nohup /usr/bin/node server.js >> logs/lumi.log 2>&1 &
echo $! > logs/lumi.pid
sleep 5
tail -40 logs/lumi.log
```

注意事项：
- **不要用 pm2**，不要 `pm2 start`，会起第二个实例抢 10000 端口。
- kill 之后到我重新上线之间约 10-30 秒，Rinka 无法跟我说话，属正常。
- 如果启动失败，`git checkout main` 再按同样方式重启即可回到现状。

## 6. 验收标准

重启后日志中应出现：
- `[Boot] pid=... git=f836eae` ← 确认跑的是基线版
- 每次对话：`[Call]` `[Chain]` `[Ctx]` `[Route]`
- 若 `[Ctx] roles` 出现 `sa...` 开头 → 孤儿 assistant 机制确认

## 7. 红线

- `.env` 不读、不改、不复制、不上传
- git 历史不改：不用 `rebase` / `filter-branch` / `reset --hard`
- 观测代码只加 console.log，不动任何业务逻辑
- 改动只提交到 `exp/baseline-logging` 分支，**不回 main**

## 8. 观察期与下一步

跑 2-3 天，收集日志。然后 `git checkout main` 切回，把 9-16 的修复版本也加日志跑一轮，两轮对比：

| 轮次 | 代码 | 目的 |
|---|---|---|
| 第一轮 | f836eae + 日志 | 记录基线行为，确认病因 |
| 第二轮 | af5a765 + 日志 | 验证 9-16 修复是否真的有效 |

两轮之后，才谈修 chat.js 的拼接 bug（第 301-308 行回溯可能停在 assistant 上）和 ai.js 第 314 行的回退链。
