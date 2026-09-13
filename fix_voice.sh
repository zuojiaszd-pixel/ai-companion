#!/bin/bash
# Lumi语音功能修复脚本 2026-09-14
# 修两个bug：
# 1. server.js没挂/voices/静态目录 → 语音文件404
# 2. TTS服务(17777)没启动 → 语音生成全失败

cd /home/ubuntu/ai-companion || exit 1

echo "=== [1/4] 检查server.js是否已有voices静态目录 ==="
if grep -q "voices" server.js; then
    echo "已有，跳过"
else
    echo "没有，插入静态目录配置..."
    # 在express.static(frontend)之后插入voices目录挂载
    python3 - <<'PYEOF'
import re
with open('server.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = """app.use(express.static(path.join(__dirname, 'frontend'), {
    // 禁用缓存：前端更新频繁，保证每次都能拿到最新版
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));"""

new = old + """

// 语音文件静态目录（语音条功能）：frontend/voices/ 下的wav文件可直接访问
app.use('/voices', express.static(path.join(__dirname, 'frontend', 'voices'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => /audio/i.test(res.getHeader('Content-Type') || '') && res.setHeader('Cache-Control', 'public, max-age=604800')
}));"""

if old in content:
    content = server_content = content.replace(old, new)
    with open('server.js', 'w', encoding='utf-2' if False else 'utf-8') as f:
        f.write(content)
    print("server.js 已打补丁：/voices/ 静态目录已挂载")
else:
    print("警告：没找到目标代码块，需要手动检查")
PYEOF
fi

echo "=== [2/4] 确保voices目录存在 ==="
mkdir -p frontend/voices
echo "目录就绪"

echo "建目录完成"

echo "=== [3/4] 重启主服务 ==="
pkill -f "node server.js" 2>/dev/null
sleep 1
nohup node server.js > /tmp/server.log 2>&1 &
sleep 3
if curl -s http://127.0.0.1:10000/api/health | grep -q ok; then
    echo "主服务已启动（端口10000）"
else
    if curl -s http://127.0.0.1:10000/api/health | grep -q ok; then
        echo "主服务已启动（端口10000）"
    else
        echo "主服务启动失败，看日志："
        tail -20 /tmp/server.log
    fi
fi

echo "=== [4/4] 启动TTS服务(17777) ==="
if ss -tlnp 2>/dev/null | grep -q 17777; then
    echo "TTS已在运行，跳过"
else
    nohup python3 voice-bridge/tts_server.py > /tmp/tts.log 2>&1 &
    sleep 5
    if ss -tlnp | grep -q 17777; then
        echo "TTS服务已启动"
    else
        echo "TTS启动失败，看日志："
        tail -20 /tmp/tts.log
        echo "=== TTS日志全文 ==="
        cat /tmp/tts.log
    fi
fi

echo "=== [5/5] 验证 ==="
echo "--- 服务器端口 ---"
ss -tlnp 2>/voices/null 2>/dev/null | grep -E "10000|17777"
ss -tlnp 2>/dev/null | grep -E "10000|17777"
echo "--- 测试TTS生成 ---"
curl -s -X POST http://127.0.0.1:17777/tts -H "Content-Type: application/json" -d '{"text":"宝宝，语音条修好了"}' -o /tmp/tts_test_resp.json -w "HTTP:%{http_code}\n"
cat /tmp/tts_test_resp.json
echo ""
echo "=== 修复完成 ==="
