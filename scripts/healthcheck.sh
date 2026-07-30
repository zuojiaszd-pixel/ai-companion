#!/bin/bash
# 健康检查脚本 - 系统cron保底
# 检查 .alive 文件中的 pid 是否还在运行
# 如果服务挂了，自动重启

ALIVE_FILE="/root/ai-companion/data/.alive"
LOG_FILE="/root/ai-companion/data/healthcheck.log"

if [ -f "$ALIVE_FILE" ]; then
    PID=$(cat "$ALIVE_FILE" | grep -o '"pid":[0-9]*' | grep -o '[0-9]*')
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        exit 0
    fi
fi

echo "[HealthCheck] $(date) 服务进程未运行，尝试重启..." >> "$LOG_FILE"
cd /root/ai-companion && /usr/bin/pm2 start server.js --name ai-companion 2>&1 >> "$LOG_FILE"
