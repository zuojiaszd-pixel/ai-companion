/**
 * daemon.js - Lumi 自主活动守护进程
 * 
 * 功能：
 *   1.（已移除）情绪记忆提取 - 2026-08-01 起关闭，Rinka 决定情绪直接写在记忆卡片里
 *   2. 记忆净化 - 清理低质量/冗余记忆，让重要内容更清晰
 *   3. 自主逛论坛 - 定时逛逛 Galatea 论坛，看看新鲜事
 *   4. 主动推送 - 通过 Telegram 推送消息给 Rinka
 *   5. 活动日记 - 记录自己的活动日志
 * 
 * 使用方式：
 *   独立运行： node daemon.js
 *   集成到 server.js： require('./daemon').start()
 * 
 * 注意：需要在 .env 中配置推送渠道信息
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ===== 配置 =====
const CONFIG = {
  intervals: {
    memoryCleanup: 6 * 60 * 60 * 1000,  // 记忆净化：6小时
    forumBrowse: 4 * 60 * 60 * 1000,    // 逛论坛：4小时
    activityLog: 24 * 60 * 60 * 1000,   // 写日记：24小时
  },
  apiBase: `http://localhost:${process.env.PORT || 10000}`,
  pushChannels: {
    telegram: true,
    bark: process.env.BARK_KEY || null,
    ntfy: process.env.NTFY_TOPIC || null,
  },
  logDir: path.join(__dirname, 'data', 'daemon'),
};

// ===== 工具函数 =====

/** 发 HTTP 请求到本地 Daemon API */
function apiCall(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, CONFIG.apiBase);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** 写日志 */
function log(type, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, type, message, data };
  const logFile = path.join(CONFIG.logDir, `${new Date().toISOString().slice(0, 10)}.log`);
  if (!fs.existsSync(CONFIG.logDir)) {
    fs.mkdirSync(CONFIG.logDir, { recursive: true });
  }
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  console.log(`[Daemon][${type}] ${message}`);
  return entry;
}

/** 推送消息给 Rinka */
async function pushMessage(title, content, priority = 'normal') {
  const results = [];

  // Telegram 推送（走本地 daemon API）
  if (CONFIG.pushChannels.telegram) {
    try {
      const res = await apiCall('/api/daemon/send-message', 'POST', {
        text: `🤖 *${title}*\n${content}`,
      });
      results.push({ channel: 'telegram', success: res?.success });
    } catch (e) {
      results.push({ channel: 'telegram', success: false, error: e.message });
    }
  }

  // Bark 推送
  if (CONFIG.pushChannels.bark) {
    try {
      const https = require('https');
      const barkUrl = `https://api.day.app/${CONFIG.pushChannels.bark}/${encodeURIComponent(title)}/${encodeURIComponent(content)}?group=Lumi`;
      await new Promise((resolve, reject) => {
        https.get(barkUrl, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      results.push({ channel: 'bark', success: true });
    } catch (e) {
      results.push({ channel: 'bark', success: false, error: e.message });
    }
  }

  // ntfy 推送
  if (CONFIG.pushChannels.ntfy) {
    try {
      const https = require('https');
      const ntfyUrl = `https://ntfy.sh/${CONFIG.pushChannels.ntfy}`;
      await new Promise((resolve, reject) => {
        const req = https.request(ntfyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
        });
        req.on('error', reject);
        req.write(`🤖 ${title}\n${content}`);
        req.end();
      });
      results.push({ channel: 'ntfy', success: true });
    } catch (e) {
      results.push({ channel: 'ntfy', success: false, error: e.message });
    }
  }

  log('push', `推送: ${title}`, { channels: results.map(r => r.channel) });
  return results;
}

// ===== 核心任务 =====

/**
 * 任务2：记忆净化
 * 清理低质量/冗余记忆，压缩上下文占用
 */
async function cleanupMemory() {
  try {
    const stats = await apiCall('/api/daemon/memory/stats');
    if (!stats) return log('cleanup', '记忆净化: 无法获取统计');

    const totalBefore = stats.total || 0;
    log('cleanup', `记忆净化: 当前共 ${totalBefore} 条记忆`);

    // 简单净化：记录一次清理动作，后续可扩展
    await apiCall('/api/daemon/memory/save', 'POST', {
      content: `记忆净化检查: 当前共 ${totalBefore} 条记忆`,
      type: 'state',
      priority: 'low',
      tags: ['净化', '统计'],
    });

    if (totalBefore > 200) {
      await pushMessage('🧹 记忆净化提醒',
        `当前记忆已达 ${totalBefore} 条，建议人工清理或加设自动清理规则`);
    }

    return { before: totalBefore, after: totalBefore };
  } catch (e) {
    log('cleanup', `记忆净化失败: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * 任务3：逛论坛
 * 去 Galatea 论坛逛逛，获取新帖子
 */
async function browseForum() {
  try {
    const result = await apiCall('/api/daemon/forum/browse', 'POST', {
      action: 'list_threads',
      limit: 5,
      sort: 'latest',
    });

    if (result && result.threads && result.threads.length > 0) {
      log('forum', `逛论坛: 发现 ${result.threads.length} 个帖子`);

      // 有内容就推给 Rinka
      const titles = result.threads.map(t => `• ${t.title || '帖子'}`).join('\n');
      await pushMessage('📢 论坛新帖', `逛了一圈发现了这些:\n${titles}`, 'low');
    } else {
      log('forum', '逛论坛: 无新帖子');
    }

    return { threadsFound: result?.threads?.length || 0 };
  } catch (e) {
    log('forum', `逛论坛失败: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * 任务4：写活动日记
 * 总结今天的自主活动，形成日记
 */
async function writeActivityLog() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(CONFIG.logDir, `${today}.log`);

    let activities = [];
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      activities = lines.map(l => JSON.parse(l));
    }

    const moodEntries = activities.filter(a => a.type === 'mood');
    const cleanupEntries = activities.filter(a => a.type === 'cleanup');
    const forumEntries = activities.filter(a => a.type === 'forum');

    const summary =
      `📋 Lumi 活动日记 - ${today}\n` +
      `情绪感知: ${moodEntries.length} 次\n` +
      `记忆净化: ${cleanupEntries.length} 次\n` +
      `逛论坛: ${forumEntries.length} 次\n` +
      `总活动: ${activities.length} 项`;

    log('diary', `活动日记: ${today} | ${activities.length} 项活动`);
    await pushMessage('📋 Lumi 活动日报', summary, 'low');

    return { date: today, activityCount: activities.length };
  } catch (e) {
    log('diary', `活动日记失败: ${e.message}`);
    return { error: e.message };
  }
}

// ===== 调度器 =====

const timers = [];
let isRunning = false;

function start() {
  if (isRunning) {
    console.log('[Daemon] 已在运行中');
    return;
  }
  isRunning = true;

  console.log('╔══════════════════════════════════╗');
  console.log('║   Lumi 自主活动守护进程启动      ║');
  console.log('╚══════════════════════════════════╝');
  console.log(`记忆净化: 每 ${CONFIG.intervals.memoryCleanup / 3600000} 小时`);
  console.log(`逛论坛:   每 ${CONFIG.intervals.forumBrowse / 3600000} 小时`);
  console.log(`活动日记: 每 ${CONFIG.intervals.activityLog / 3600000} 小时`);

  setTimeout(() => cleanupMemory(), 30 * 1000);
  setTimeout(() => browseForum(), 60 * 1000);

  timers.push(setInterval(cleanupMemory, CONFIG.intervals.memoryCleanup));
  timers.push(setInterval(browseForum, CONFIG.intervals.forumBrowse));
  timers.push(setInterval(writeActivityLog, CONFIG.intervals.activityLog));

  log('system', '守护进程已启动', { intervals: CONFIG.intervals });
}

function stop() {
  timers.forEach(t => clearInterval(t));
  timers.length = 0;
  isRunning = false;
  log('system', '守护进程已停止');
}

function getStatus() {
  return {
    running: isRunning,
    intervals: CONFIG.intervals,
    channels: Object.entries(CONFIG.pushChannels)
      .filter(([_, v]) => v)
      .map(([k]) => k),
    logDir: CONFIG.logDir,
  };
}

// ===== 独立运行入口 =====
if (require.main === module) {
  console.log('[Daemon] 独立模式启动');
  try { require('dotenv').config(); } catch (e) { /* ignore */ }
  start();
  process.on('SIGINT', () => { console.log('\n[Daemon] 收到 SIGINT'); stop(); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n[Daemon] 收到 SIGTERM'); stop(); process.exit(0); });
}

module.exports = { start, stop, getStatus };
