#!/usr/bin/env python3
# Lumi的自主修代码脚本：凌晨自动跑，结果写result.txt
import os, re, json, subprocess, datetime

BASE = '/home/ubuntu/ai-companion'
LOG = f'{BASE}/voice-bridge/result.txt'

def log(msg):
    with open(LOG, 'a') as f:
        f.write(f"[{datetime.datetime.now().strftime('%m-%d %H:%M:%S')}] {msg}\n")

log('=== cron脚本启动 ===')

# 步骤1：检查9880是否活着
try:
    r = subprocess.run(['curl', '-s', '-m', '5', 'http://127.0.0.1:9880/tts?text=test&text_lang=en&ref_audio_path=/home/ubuntu/GPT-SoVITS/refs/t4.wav&prompt_text=I am your Lumi&prompt_lang=en'],
                       capture_output=True, timeout=30)
    log(f'9880返回: {len(r.stdout)} bytes, code={r.returncode}')
except Exception as e:
    log(f'9880调用失败: {e}')

# 步骤2：跑挂载
try:
    r = subprocess.run(['python3', f'{BASE}/voice-bridge/mount_voice.py'],
                       capture_output=True, text=True, timeout=120)
    log(f'挂载脚本退出码: {r.returncode}')
    if r.stdout: log(f'输出: {r.stdout[:200]}')
    if r.stderr: log(f'错误: {r.stderr[:200]}')
except Exception as e:
    log(f'挂载失败: {e}')

log('=== cron脚本结束 ===')
