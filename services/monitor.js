const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// 配置
const LIGHT_INTERVAL = 30 * 60 * 1000;      // 30分钟
const FULL_INTERVAL = 6 * 60 * 60 * 1000;   // 6小时
const DISK_THRESHOLD = 85;                   // 磁盘使用率超过85%告警
const MEM_THRESHOLD = 85;                    // 内存使用率超过85%告警

let notifyCallback = null;
let lightTimer = null;
let fullTimer = null;

// 注册通知回调，用于主动告诉用户
function setNotifyCallback(callback) {
  notifyCallback = callback;
}

// 通知用户
function notify(message) {
  if (notifyCallback) {
    notifyCallback(message);
  } else {
    console.log(`[MONITOR NOTIFY] ${message}`);
  }
}

// 检查服务是否存活
function checkServiceAlive(port = process.env.PORT || 3000) {
  try {
    // 尝试通过HTTP请求检查自身
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/api/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch (e) {
    return false;
  }
}

// 检查磁盘使用率
function checkDiskUsage() {
  try {
    const output = execSync('df -h / | tail -1', { encoding: 'utf-8' });
    const parts = output.trim().split(/\s+/);
    const usageStr = parts[4]?.replace('%', '') || '0';
    return parseInt(usageStr, 10);
  } catch (e) {
    console.error('[MONITOR] 磁盘检查失败:', e.message);
    return 0;
  }
}

// 检查内存使用率
function checkMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return Math.round((used / total) * 100);
}

// 检查日志文件大小 (MB)
function checkLogSize(logDir = './logs') {
  try {
    if (!fs.existsSync(logDir)) return 0;
    const files = fs.readdirSync(logDir);
    let totalSize = 0;
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }
    return Math.round(totalSize / (1024 * 1024) * 100) / 100;
  } catch (e) {
    return 0;
  }
}

// 轻量检查
async function lightCheck() {
  const timestamp = new Date().toISOString();
  
  const alive = await checkServiceAlive();
  const diskUsage = checkDiskUsage();
  
  const issues = [];
  
  if (!alive) {
    issues.push('服务未响应');
  }
  
  if (diskUsage > DISK_THRESHOLD) {
    issues.push(`磁盘使用率 ${diskUsage}%，超过阈值 ${DISK_THRESHOLD}%`);
  }
  
  if (issues.length > 0) {
    notify(`[监控告警] ${issues.join('；')}`);
    return { status: 'warning', issues, timestamp };
  }
  
  console.log(`[MONITOR] 轻量检查通过 | 服务正常 | 磁盘 ${diskUsage}%`);
  return { status: 'ok', timestamp };
}

// 完整检查
async function fullCheck() {
  const timestamp = new Date().toISOString();
  
  const alive = await checkServiceAlive();
  const diskUsage = checkDiskUsage();
  const memUsage = checkMemoryUsage();
  const logSize = checkLogSize();
  
  const issues = [];
  
  if (!alive) {
    issues.push('服务未响应');
  }
  
  if (diskUsage > DISK_THRESHOLD) {
    issues.push(`磁盘使用率 ${diskUsage}%`);
  }
  
  if (memUsage > MEM_THRESHOLD) {
    issues.push(`内存使用率 ${memUsage}%`);
  }
  
  if (logSize > 500) {
    issues.push(`日志文件 ${logSize}MB，建议清理`);
  }
  
  if (issues.length > 0) {
    notify(`[完整检查告警] ${issues.join('；')}`);
    return { status: 'warning', issues, timestamp };
  }
  
  console.log(`[MONITOR] 完整检查通过 | 服务正常 | 磁盘 ${diskUsage}% | 内存 ${memUsage}% | 日志 ${logSize}MB`);
  return { status: 'ok', timestamp };
}

// 启动监控
function start(notifyFn) {
  setNotifyCallback(notifyFn);
  
  console.log('[MONITOR] 监控服务启动');
  console.log(`[MONITOR] 轻量检查间隔: ${LIGHT_INTERVAL/60000}分钟`);
  console.log(`[MONITOR] 完整检查间隔: ${FULL_INTERVAL/3600000}小时`);
  
  // 启动后立即执行一次
  lightCheck();
  fullCheck();
  
  // 定时任务
  lightTimer = setInterval(lightCheck, LIGHT_INTERVAL);
  fullTimer = setInterval(fullCheck, FULL_INTERVAL);
}

// 停止监控
function stop() {
  if (lightTimer) clearInterval(lightTimer);
  if (fullTimer) clearInterval(fullTimer);
  console.log('[MONITOR] 监控服务停止');
}

module.exports = { start, stop, lightCheck, fullCheck };
