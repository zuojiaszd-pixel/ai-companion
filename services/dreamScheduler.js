const memoryService = require('./memory');
const fs = require('fs');
const path = require('path');

const DREAM_INTERVAL = 6 * 60 * 60 * 1000;  // 6小时一次
let dreamTimer = null;
let notifyCallback = null;

function setNotifyCallback(callback) {
  notifyCallback = callback;
}

function notify(message) {
  if (notifyCallback) {
    notifyCallback(message);
  } else {
    console.log(`[DreamScheduler] ${message}`);
  }
}

async function runDreamTask() {
  const startTime = Date.now();
  console.log('[DreamScheduler] 开始整理...');

  try {
    const log = await memoryService.runDream('default');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const summary = `[Dream整理] 完成 | 耗时${elapsed}s | 总${log.total}条 | 归档${log.archived}条 | 衰减${log.decayed}条 | 锁定${log.locked}条`;

    // 保存日志
    const dir = './data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const logPath = './data/dream_log.json';
    let logs = [];
    if (fs.existsSync(logPath)) {
      logs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    }
    log.timestamp = new Date();
    logs.push(log);
    if (logs.length > 50) logs = logs.slice(-50);
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));

    console.log(`[DreamScheduler] ${summary}`);

    // 归档数量超过阈值时通知
    if (log.archived > 50) {
      notify(`[Dream整理报告] 本次归档了 ${log.archived} 条记忆，建议关注记忆库状况`);
    }
    if (log.total > 2000) {
      notify(`[Dream整理报告] 记忆总数已达 ${log.total} 条，建议考虑备份`);
    }
  } catch (e) {
    console.error('[DreamScheduler] 整理失败:', e.message);
  }
}

function start(notifyFn) {
  setNotifyCallback(notifyFn);

  console.log('[DreamScheduler] Dream整理服务启动');
  console.log(`[DreamScheduler] 整理间隔: ${DREAM_INTERVAL / 3600000}小时`);

  // 启动后延迟5分钟再执行第一次，避免服务刚启动时资源紧张
  setTimeout(() => {
    runDreamTask();
  }, 5 * 60 * 1000);

  dreamTimer = setInterval(runDreamTask, DREAM_INTERVAL);
}

function stop() {
  if (dreamTimer) {
    clearInterval(dreamTimer);
    dreamTimer = null;
  }
  console.log('[DreamScheduler] Dream整理服务停止');
}

module.exports = { start, stop };
