const fs = require('fs');
const path = require('path');

// 每分钟执行一次的定时任务
setInterval(() => {
  const now = new Date();
  const timestamp = now.toISOString();
  console.log(`[${timestamp}] 执行定时任务...`);
  
  // 记录到日志文件
  const logFile = path.join(__dirname, 'cron.log');
  const logEntry = `[${timestamp}] 定时任务执行\n`;
  
  fs.appendFile(logFile, logEntry, (err) => {
    if (err) console.error('写入日志失败:', err);
  });
}, 60000); // 每分钟执行一次

console.log('定时任务已启动，每分钟执行一次');