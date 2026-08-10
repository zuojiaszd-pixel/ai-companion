/**
 * patch_task_remind.js
 * 1) tools.js 增加 add_task / list_pending_tasks 两个静态工具（Lumi 对话里直接给 Rinka 加任务、查任务）
 * 2) daemon.js 增加任务督促调度 remindTasks（定时检查未完成备忘录并推送提醒）
 * 用 node scripts/patch_task_remind.js 执行
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const toolsPath = path.join(root, 'services', 'tools.js');
const daemonPath = path.join(root, 'daemon.js');

let log = [];

// ========== 1. tools.js ==========
let tools = fs.readFileSync(toolsPath, 'utf-8');

// 1a. 静态工具定义：在 set_status 定义后追加两个新工具
const setStatusTool = `    {
        type: "function",
        function: {
            name: "set_status",
            description: "设置状态栏",
            parameters: { type: "object", properties: { status: { type: "string", description: "状态内容" } }, required: ["status"] }
        }
    }
];`;

const newTools = `    {
        type: "function",
        function: {
            name: "set_status",
            description: "设置状态栏",
            parameters: { type: "object", properties: { status: { type: "string", description: "状态内容" } }, required: ["status"] }
        }
    },
    {
        type: "function",
        function: {
            name: "add_task",
            description: "给Rinka添加任务/备忘录（会出现在日历的【备忘录】里，Lumi可以随时给她加任务并督促完成）。date 可选，默认今天。",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "任务内容" },
                    date: { type: "string", description: "截止日期 YYYY-MM-DD（可选，默认今天）" }
                },
                required: ["title"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_pending_tasks",
            description: "查看Rinka当前未完成的任务/备忘录",
            parameters: { type: "object", properties: {} }
        }
    }
];`;

if (tools.includes(setStatusTool)) {
    tools = tools.replace(setStatusTool, newTools);
    log.push('tools.js: 已追加 add_task / list_pending_tasks 工具定义');
} else {
    log.push('tools.js: 未找到 set_status 工具定义锚点！');
}

// 1b. executeTool switch：在 set_status case 后追加两个 case
const setStatusCase = `            case 'set_status': {
                const statusFile = path.join(__dirname, '..', 'config', 'status.json');
                const data = { status: args.status || '', updatedAt: new Date().toISOString() };
                const dir = path.dirname(statusFile);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf-8');
                return '状态已设置: ' + (args.status || '');
            }
            default:`;

const newCases = `            case 'set_status': {
                const statusFile = path.join(__dirname, '..', 'config', 'status.json');
                const data = { status: args.status || '', updatedAt: new Date().toISOString() };
                const dir = path.dirname(statusFile);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf-8');
                return '状态已设置: ' + (args.status || '');
            }
            case 'add_task': {
                const Calendar = require('../models/Calendar');
                const title = String(args.title || '').trim();
                if (!title) return '任务内容不能为空';
                const date = args.date || new Date().toISOString().slice(0, 10);
                const item = await Calendar.create({ date, title, color: '#f5a0b8', type: 'memo', done: false, sessionId: 'default' });
                return '任务已添加：' + title + '（' + date + '）';
            }
            case 'list_pending_tasks': {
                const Calendar = require('../models/Calendar');
                const tasks = await Calendar.find({ type: 'memo', done: false }).sort({ date: 1, createdAt: -1 }).limit(50).lean();
                if (!tasks.length) return '当前没有未完成的任务，很乖嘛';
                const today = new Date().toISOString().slice(0, 10);
                return tasks.map(t => '- [' + (t.date || '无日期') + (t.date && t.date < today ? ' 已过期' : (t.date === today ? ' 今天' : '')) + '] ' + t.title).join('\\n');
            }
            default:`;

if (tools.includes(setStatusCase)) {
    tools = tools.replace(setStatusCase, newCases);
    log.push('tools.js: 已追加 add_task / list_pending_tasks 执行逻辑');
} else {
    log.push('tools.js: 未找到 set_status case 锚点！');
}

fs.writeFileSync(toolsPath, tools, 'utf-8');

// ========== 2. daemon.js ==========
let daemon = fs.readFileSync(daemonPath, 'utf-8');

// 2a. 配置：intervals 增加 taskRemind
const intervalAnchor = `    activityLog: 24 * 60 * 60 * 1000,   // 写日记：24小时`;
const intervalNew = `    activityLog: 24 * 60 * 60 * 1000,   // 写日记：24小时
    taskRemind: 4 * 60 * 60 * 1000,     // 任务督促：4小时（检查未完成待办并推送提醒）`;

if (daemon.includes(intervalAnchor)) {
    daemon = daemon.replace(intervalAnchor, intervalNew);
    log.push('daemon.js: 已增加 taskRemind 间隔配置');
} else {
    log.push('daemon.js: 未找到 intervals 锚点！');
}

// 2b. 增加 remindTasks 函数（插在 writeActivityLog 之后、调度器之前）
const schedulerAnchor = `// ===== 调度器 =====`;

const remindFunc = `
/**
 * 任务4.5：督促 Rinka 完成待办
 * 扫描未完成的备忘录（今天到期 / 已过期），通过推送提醒她。
 * 防打扰：
 *   - 只在 8:00~22:00 推送，避免半夜吵醒
 *   - 每个任务每天最多提醒一次（状态记录在 data/daemon/task_remind_state.json）
 */
const REMIND_STATE_FILE = path.join(__dirname, 'data', 'daemon', 'task_remind_state.json');

function loadRemindState() {
    try {
        if (fs.existsSync(REMIND_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(REMIND_STATE_FILE, 'utf-8'));
        }
    } catch (e) { /* 忽略损坏的状态文件 */ }
    return {};
}

function saveRemindState(state) {
    try {
        const dir = path.dirname(REMIND_STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(REMIND_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) { /* 写失败不影响主流程 */ }
}

async function remindTasks() {
    try {
        // 只在合适的时间段督促（早8点到晚10点），别半夜吵醒Rinka
        const hour = new Date().getHours();
        if (hour < 8 || hour >= 22) {
            log('remind', '任务督促: 非推送时段(8-22点)，跳过');
            return { skipped: 'off-hours' };
        }

        const res = await apiCall('/api/daemon/calendar/memos?done=false&limit=100');
        const tasks = Array.isArray(res) ? res : (res && res.memos) || [];
        if (!tasks.length) {
            log('remind', '任务督促: 没有未完成任务，不用督促');
            return { pending: 0, reminded: 0 };
        }

        const today = new Date().toISOString().slice(0, 10);
        const state = loadRemindState();
        const needRemind = [];
        const overdue = [];
        const dueToday = [];

        tasks.forEach(t => {
            const d = t.date || '';
            if (d && d < today) overdue.push(t);
            else if (d === today) dueToday.push(t);
        });

        [...overdue, ...dueToday].forEach(t => {
            if (state[t._id] !== today) {
                state[t._id] = today;
                needRemind.push(t);
            }
        });

        if (!needRemind.length) {
            log('remind', \`任务督促: 有 \${overdue.length + dueToday.length} 条到期待办，今天已提醒过\`);
            return { pending: tasks.length, reminded: 0 };
        }

        saveRemindState(state);

        const lines = needRemind.map(t => {
            const d = t.date || '';
            let tag = '';
            if (d && d < today) tag = '（已过期）';
            else if (d === today) tag = '（今天到期）';
            return '• ' + t.title + ' ' + tag;
        });
        const content = '今天还有这些事没做完呢：\\n' + lines.join('\\n') +
            '\\n\\n要不要现在抽几分钟搞定？做完了记得去日历打勾，我可是一直盯着的哦 😉';

        await pushMessage('📝 任务督促', content, 'normal');
        log('remind', \`任务督促: 已提醒 \${needRemind.length} 条\`, { total: tasks.length });
        return { pending: tasks.length, reminded: needRemind.length };
    } catch (e) {
        log('remind', \`任务督促失败: \${e.message}\`);
        return { error: e.message };
    }
}

// ===== 调度器 =====`;

if (daemon.includes(schedulerAnchor)) {
    daemon = daemon.replace(schedulerAnchor, remindFunc);
    log.push('daemon.js: 已插入 remindTasks 函数');
} else {
    log.push('daemon.js: 未找到调度器锚点！');
}

// 2c. start() 里打印启动信息 + 注册定时器
const startLogAnchor = `  console.log(\`活动日记: 每 \${CONFIG.intervals.activityLog / 3600000} 小时\`);`;
const startLogNew = `  console.log(\`活动日记: 每 \${CONFIG.intervals.activityLog / 3600000} 小时\`);
  console.log(\`任务督促: 每 \${CONFIG.intervals.taskRemind / 3600000} 小时\`);`;

if (daemon.includes(startLogAnchor)) {
    daemon = daemon.replace(startLogAnchor, startLogNew);
    log.push('daemon.js: 已增加启动日志');
} else {
    log.push('daemon.js: 未找到启动日志锚点！');
}

const timerAnchor = `  setTimeout(() => cleanupMemory(), 30 * 1000);
  setTimeout(() => browseForum(), 60 * 1000);

  timers.push(setInterval(cleanupMemory, CONFIG.intervals.memoryCleanup));
  timers.push(setInterval(browseForum, CONFIG.intervals.forumBrowse));
  timers.push(setInterval(writeActivityLog, CONFIG.intervals.activityLog));`;

const timerNew = `  setTimeout(() => cleanupMemory(), 30 * 1000);
  setTimeout(() => browseForum(), 60 * 1000);
  setTimeout(() => remindTasks(), 120 * 1000);

  timers.push(setInterval(cleanupMemory, CONFIG.intervals.memoryCleanup));
  timers.push(setInterval(browseForum, CONFIG.intervals.forumBrowse));
  timers.push(setInterval(writeActivityLog, CONFIG.intervals.activityLog));
  timers.push(setInterval(remindTasks, CONFIG.intervals.taskRemind));`;

if (daemon.includes(timerAnchor)) {
    daemon = daemon.replace(timerAnchor, timerNew);
    log.push('daemon.js: 已注册 remindTasks 定时器');
} else {
    log.push('daemon.js: 未找到定时器锚点！');
}

fs.writeFileSync(daemonPath, daemon, 'utf-8');

console.log('==== patch 结果 ====');
log.forEach(l => console.log(l));
