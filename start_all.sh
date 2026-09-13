#!/bin/bash
# Lumi 一键启动：主服务 + TTS服务，带内存保护
cd /home/ubuntu/ai-companion

echo "=== 内存状况 ==="
free -m | head -2

# 杀掉旧进程避免端口冲突
pkill -f "node server.js" 2>/dev/null
pkill -f "tts_server.py" 2>/dev/null
sleep 1

# 启动主服务
nohup node server.js > /tmp/server.log 2>&1 &
echo "主服务 PID: $!"

# 启动TTS服务
nohup python3 voice-bridge/tts_server.py > /tmp/tts.log 2>&1 &
echo "TTS PID: $!"

# 等服务起来
sleep 5

echo "=== 端口检查 ==="
ss -tlnp | grep -E "3000|17777" && echo "✅ 服务已启动" || echo "⚠️ 有服务没起来，看日志"

echo "=== 内存状况（启动后）==="
free -m | head -2
