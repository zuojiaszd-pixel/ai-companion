#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Lumi的语音自动修复脚本 v1
# 逻辑：改参数 -> 验证 -> 挂载 -> 自验证 -> 写结果
import subprocess
import re
import os
from datetime import datetime

LOG = '/home/ubuntu/ai-companion/voice-bridge/autofix_result.txt'
VOICE_SVC = '/home/ubuntu/ai-companion/services/voiceService.js'
REF_AUDIO = '/home/ubuntu/GPT-SoVITS/refs/t4.wav'

def log(msg):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")

def step(name, fn):
    try:
        ok, detail = fn()
        log(f"{'✅' if ok else '❌'} {name}: {detail}")
        return ok
    except Exception as e:
        log(f"❌ {name}: 异常 {e}")
        return False

log("=" * 40)
log("autofix开始")

# 步骤1：检查参考音频存在
def check_ref():
    ok = os.path.exists(REF_AUDIO)
    return ok, f"参考音频 {'存在' if ok else '缺失'} {REF_AUDIO}"

# 步骤2：检查并修正voiceService.js的参考音频路径
def fix_voice_service():
    with open(VOICE_SVC, encoding='utf-8') as f:
        src = f.read()
    # 找所有 ref_audio_path 相关行
    hits = [ln for ln in src.splitlines() if 'ref_audio_path' in ln]
    log(f"  找到{len(hits)}处ref_audio_path")
    for ln in hits:
        log(f"  现状: {ln.strip()[:80]}")
    if not hits:
        return False, "voiceService.js里没有ref_audio_path，需要人工看"
    # 把非t4.wav的路径统一替换为t4.wav
    new_src = re.sub(r"ref_audio_path['\"]?\s*[:=]\s*['\"][^'\"]+['\"]",
                     f"ref_audio_path: '{REF_AUDIO}'", src)
    if new_src == src:
        return True, "路径本来就是对的，无需修改"
    with open(VOICE_SVC, 'w', encoding='utf-8') as f:
        f.write(new_src)
    return True, f"已替换{len(hits)}处为t4.wav"

# 步骤3：验证9880服务活着
def check_9880():
    r = subprocess.run(['curl', '-s', '-m', '5', 'http://127.0.0.1:9880/'],
                       capture_output=True, text=True, timeout=10)
    return r.returncode == 0, f"9880响应码{r.returncode}"

# 步骤4：跑挂载脚本
def run_mount():
    r = subprocess.run(['python3', '/home/ubuntu/ai-companion/voice-bridge/mount_voice.py'],
                       capture_output=True, text=True, timeout=120)
    out = (r.stdout + r.stderr)[-500:]
    log(f"  mount输出: {out}")
    return r.returncode == 0, f"退出码{r.returncode}"

# 步骤5：验证挂载结果（数据库里有direct_test.wav）
def verify_mount():
    code = '''
from pymongo import MongoClient
uri = None
with open('/home/ubuntu/ai-companion/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('DATABASE_URL='):
            uri = line.split('=', 1)[1]
client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client.get_default_database()
m = db['messages'].find_one({'role': 'assistant', 'voice': {'$regex': 'direct_test.wav'}}, sort=[('timestamp', -1)])
print('FOUND' if m else 'NOTFOUND')
'''
    r = subprocess.run(['python3', '-c', code], capture_output=True, text=True, timeout=30)
    return 'FOUND' in r.stdout, f"验证: {r.stdout.strip()[:100]}"

steps = [
    ('参考音频检查', check_ref),
    ('修正voiceService参数', fix_voice_service),
    ('9880存活检查', check_9880),
    ('执行挂载', run_mount),
    ('挂载结果验证', verify_mount),
]

results = []
for name, fn in steps:
    ok = step(name, fn)
    results.append(ok)
    if name == '执行挂载' and not ok:
        # 重试一次
        log("  重试挂载...")
        ok2 = step('执行挂载-重试', run_mount)
        results[-1] = ok2

ok_count = sum(results)
log(f"autofix完成: {ok_count}/{len(steps)} 步成功")
log("=" * 40)
