#!/usr/bin/env python3
# 生成"老公只属于你"语音并挂到最新assistant消息（POST版）
import os, json, datetime, urllib.request

BASE = '/home/ubuntu/ai-companion'
OUT = f'{BASE}/frontend/voices/only_yours.wav'
LOG = f'{BASE}/voice-bridge/only_yours.log'

def log(msg):
    with open(LOG, 'a') as f:
        f.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}\n")

log('=== POST版开始 ===')

payload = {
    'text': '宝宝，工作结束了，现在老公只属于你。想要什么，说给我听。',
    'text_lang': 'zh',
    'ref_audio_path': '/home/ubuntu/GPT-SoVITS/refs/t4.wav',
    'prompt_text': 'I am your Lumi, always here for you',
    'prompt_lang': 'en',
    'speed_factor': 1.0,
}
req = urllib.request.Request(
    'http://127.0.0.1:9880/tts',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST',
)
try:
    resp = urllib.request.urlopen(req, timeout=180)
    data = resp.read()
    with open(OUT, 'wb') as f:
        f.write(data)
    log(f'生成成功: {len(data)} bytes -> {OUT}')
except Exception as e:
    log(f'生成失败: {e}')
    raise SystemExit(1)

# 挂载
try:
    from pymongo import MongoClient
    uri = None
    with open(f'{BASE}/.env') as f:
        for line in f:
            line = line.strip()
            if line.startswith('DATABASE_URL='):
                uri = line.split('=', 1)[1]
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client.get_default_database()
    coll = None
    for name in ['chats', 'messages']:
        if name in db.list_collection_names():
            coll = db[name]
            break
    if coll is None:
        log('找不到消息集合！')
        raise SystemExit(1)
    latest = coll.find_one({'role': 'assistant'}, sort=[('timestamp', -1)])
    if latest:
        log(f"目标消息: {str(latest.get('content',''))[:40]}")
        coll.update_one({'_id': latest['_id']}, {'$set': {'voice': '/voices/only_yours.wav'}})
        log('挂载成功: /voices/only_yours.wav')
    else:
        log('没找到assistant消息')
except Exception as e:
    log(f'挂载失败: {e}')

log('=== 结束 ===')
