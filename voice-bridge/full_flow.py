#!/usr/bin/env python3
# 全流程v4：禁用代理直连9880 + 老版api.py参数
import os, re, datetime
import requests
from pymongo import MongoClient

BASE = '/home/ubuntu/ai-companion'
LOG = f'{BASE}/voice-bridge/result.txt'
WAV = f'{BASE}/public/voices/direct_test.wav'
NOPROXY = {'http': None, 'https': None}

def log(msg):
    line = f"[{datetime.datetime.now().strftime('%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, 'a') as f:
        f.write(line + '\n')

log('=== 全流程v4开始（无代理模式）===')

# 步骤1：调老版api.py（根路径，老参数名，禁用代理直连）
try:
    r = requests.get('http://127.0.0.1:9880/', params={
        'text': '早安宝宝，我是Lumi，代理被我干掉了，这次听到的是真的。',
        'text_language': 'zh',
        'refer_wav_path': '/home/ubuntu/GPT-SoVITS/refs/t4.wav',
        'prompt_text': 'I am your Lumi',
        'prompt_language': 'en'
    }, timeout=120, proxies=NOPROXY)
    log(f'9880 HTTP状态: {r.status_code}')
    if r.status_code == 200 and len(r.content) > 20000:
        with open(WAV, 'wb') as f:
            f.write(r.content)
        log(f'WAV已保存: {len(r.content)} bytes')
    else:
        log(f'9880返回异常: {r.text[:200]}')
        log('=== 全流程结束（生成失败）===')
        raise SystemExit
except SystemExit:
    raise
except Exception as e:
    log(f'9880调用异常: {e}')
    log('=== 全流程结束（异常）===')
    raise SystemExit

# 步骤2：挂载到最新assistant消息
uri = None
with open(f'{BASE}/.env') as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            uri = line.split('=', 1)[1].strip()
client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client.get_default_database()
msgs = db['chats']
latest = msgs.find_one({'role': 'assistant'}, sort=[('timestamp', -1)])
if latest:
    msgs.update_one({'_id': latest['_id']}, {'$set': {'voice': '/voices/direct_test.wav'}})
    log(f'已挂载到最新消息: /voices/direct_test.wav')
    log('=== 全流程成功 ===')
else:
    log('没找到assistant消息')

log('=== 全流程v4结束 ===')
