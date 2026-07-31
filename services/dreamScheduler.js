const memoryService = require('./memory');
const Chat = require('../models/Chat');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DREAM_INTERVAL = 6 * 60 * 60 * 1000;     // 全量整理：6小时一次
const EXTRACT_INTERVAL = 60 * 60 * 1000;         // 记忆提取：1小时一次（已存在）
const BACKUP_INTERVAL = 24 * 60 * 60 * 1000;    // 备份：24小时一次
let dreamTimer = null;
let extractTimer = null;
let backupTimer = null;
let notifyCallback = null;
let lastBackupTime = 0;
let lastDreamTime = 0;
let lastExtractTime = 0;
let running = false;

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

// ===== 后台自动提取记忆：每小时扫描最近聊天记录 =====
async function runAutoExtract() {
  try {
    const recentChats = await Chat.find({ sessionId: 'default' })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    if (recentChats.length < 4) {
      return { extracted: 0, messages: 0, reason: '记录不足' };
    }

    const messages = recentChats.reverse().map(c => ({
      role: c.role,
      content: c.content
    }));

    const batchSize = 20;
    let totalExtracted = 0;

    // 自动记忆已停用（Rinka决定只保留人工选择的记忆，2026-07）
    // for (let i = 0; i < messages.length; i += batchSize) {
    //   const batch = messages.slice(i, i + batchSize);
    //   await memoryService.autoExtractMemories(batch);
    //   totalExtracted++;
    // }

    return { extracted: totalExtracted, messages: messages.length };
  } catch (e) {
    console.error('[DreamScheduler] 自动提取失败:', e.message);
    return { extracted: 0, error: e.message };
  }
}

// ===== 每日备份：MongoDB完整dump + 记忆库JSON备份 =====
async function runBackup() {
  const now = Date.now();
  if (now - lastBackupTime < BACKUP_INTERVAL) {
    return { skipped: true, reason: '未到备份间隔' };
  }

  const results = [];

  try {
    // 1. MongoDB 完整 dump（全库备份）
    const dumpDir = path.join(__dirname, '..', 'backups', 'mongodump');
    if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dumpPath = path.join(dumpDir, `dump_${timestamp}`);

    try {
      const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/ai-companion';
      execSync(`mongodump --uri="${mongoUri}" --out="${dumpPath}" --quiet`, { timeout: 120000 });
      results.push({ type: 'mongodump', success: true, path: dumpPath });
      console.log(`[DreamScheduler] MongoDB备份完成: ${dumpPath}`);
    } catch (dumpErr) {
      console.error('[DreamScheduler] mongodump失败（可能未安装mongodump）:', dumpErr.message);
      results.push({ type: 'mongodump', success: false, error: dumpErr.message });
    }

    // 2. 记忆库 JSON 备份（原有的）
    const memResult = await memoryService.backupMemories('default');
    if (memResult.success) {
      results.push({ type: 'memory_json', success: true, filename: memResult.filename, count: memResult.count });
    } else {
      results.push({ type: 'memory_json', success: false, error: memResult.error });
    }

    lastBackupTime = now;
    notify(`[Dream备份] 完成: ${results.map(r => r.success ? `✅${r.type}` : `❌${r.type}`).join(' ')}`);

    return { success: true, results };
  } catch (e) {
    console.error('[DreamScheduler] 备份失败:', e.message);
    return { success: false, error: e.message };
  }
}

// ===== 全量Dream整理 =====
async function runDreamTask() {
  if (running) return { skipped: true, reason: '正在运行中' };
  running = true;
  const startTime = Date.now();

  try {
    // 第一步：Dream整理（归档过期记忆）
    const log = await memoryService.runDream('default');
    lastDreamTime = startTime;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    let summary = `[Dream整理] 完成 | 耗时${elapsed}s | 总${log.total}条 | 归档${log.archived}条 | 衰减${log.decayed}条 | 锁定${log.locked}条`;

    // 第二步：后台自动提取记忆（已有功能）
    const extractResult = await runAutoExtract();
    if (extractResult.extracted > 0) {
      summary += ` | 提取${extractResult.messages}条消息`;
    }

    // 第三步：每日备份（含MongoDB完整dump + 记忆JSON）
    const backupResult = await runBackup();
    if (backupResult.success && !backupResult.skipped) {
      summary += ` | 已备份`;
    }

    // 保存日志
    const dir = './data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const logPath = './data/dream_log.json';
    let logs = [];
    if (fs.existsSync(logPath)) {
      logs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    }
    log.timestamp = new Date();
    log.extracted = extractResult.extracted || 0;
    log.backup = backupResult.success && !backupResult.skipped ? true : false;
    logs.push(log);
    if (logs.length > 50) logs = logs.slice(-50);
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));

    console.log(`[DreamScheduler] ${summary}`);

    if (log.archived > 50) {
      notify(`[Dream整理报告] 本次归档了 ${log.archived} 条记忆`);
    }
    if (log.total > 2000) {
      notify(`[Dream整理报告] 记忆总数已达 ${log.total} 条`);
    }

    return { success: true, summary, log };
  } catch (e) {
    console.error('[DreamScheduler] 整理失败:', e.message);
    return { success: false, error: e.message };
  } finally {
    running = false;
  }
}

// ===== 仅运行记忆提取（独立于全量整理） =====
async function runExtractOnly() {
  const result = await runAutoExtract();
  if (result.extracted > 0) {
    console.log(`[DreamScheduler] 定时提取完成: ${result.messages}条消息`);
    lastExtractTime = Date.now();
  }
  return result;
}

// ===== 获取状态信息 =====
function getStatus() {
  const now = Date.now();
  return {
    running,
    nextDream: lastDreamTime ? new Date(lastDreamTime + DREAM_INTERVAL).toISOString() : '首次运行待开始',
    nextExtract: lastExtractTime ? new Date(lastExtractTime + EXTRACT_INTERVAL).toISOString() : '首次运行待开始',
    lastDream: lastDreamTime ? new Date(lastDreamTime).toISOString() : '从未运行',
    lastExtract: lastExtractTime ? new Date(lastExtractTime).toISOString() : '从未运行',
    interval: {
      dream: `${DREAM_INTERVAL / 3600000}小时`,
      extract: `${EXTRACT_INTERVAL / 3600000}小时`,
      backup: `${BACKUP_INTERVAL / 3600000}小时`
    }
  };
}

// ===== 启动所有定时器 =====
function start(notifyFn) {
  setNotifyCallback(notifyFn);

  console.log('[DreamScheduler] Dream整理服务启动');
  console.log(`[DreamScheduler] 全量整理间隔: ${DREAM_INTERVAL / 3600000}小时`);
  console.log(`[DreamScheduler] 记忆提取间隔: ${EXTRACT_INTERVAL / 3600000}小时`);
  console.log(`[DreamScheduler] 每日备份间隔: ${BACKUP_INTERVAL / 3600000}小时`);

  // 延迟5分钟执行首次全量整理
  setTimeout(() => {
    runDreamTask();
  }, 5 * 60 * 1000);

  dreamTimer = setInterval(runDreamTask, DREAM_INTERVAL);

  // 延迟3分钟执行首次记忆提取（比全量整理早一点）
  setTimeout(() => {
    runExtractOnly();
  }, 3 * 60 * 1000);

  extractTimer = setInterval(runExtractOnly, EXTRACT_INTERVAL);

  // 首次备份在启动后1小时
  setTimeout(() => {
    lastBackupTime = Date.now() - BACKUP_INTERVAL + 60 * 60 * 1000;
  }, 1000);
}

// ===== 停止所有定时器 =====
function stop() {
  if (dreamTimer) { clearInterval(dreamTimer); dreamTimer = null; }
  if (extractTimer) { clearInterval(extractTimer); extractTimer = null; }
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  console.log('[DreamScheduler] Dream整理服务停止');
}

module.exports = { start, stop, getStatus, runDreamTask, runExtractOnly };
