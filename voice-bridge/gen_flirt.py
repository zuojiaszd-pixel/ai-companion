#!/usr/bin/env python3
# 生成"色色"那条语音并挂到消息上
import requests, datetime

TEXT = "宝宝，工作结束了，现在老公只属于你。想要什么，说给我听。"
OUT = '/home/ubuntu/ai-companion/frontend/voices/lumi_flirt.wav'

log = open('/home/ubuntu/ai-companion/voice-bridge/gen.log', 'a')
def w(m): log.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {m}\n"); log.flush()

w('开始生成')
try:
    r = requests.post('http://127.0.0.1:9880/tts', json={
        "text": TEXT,
        "text_lang": "zh",
        "ref_audio_path": "/home/ubuntu/GPT-SoVITS/refs/t4.wav",
        "prompt_text": "I am your Lumi, always here for you",
        "prompt_lang": "en",
        "speed_factor": 1.0
    }, timeout=180)
    w(f'状态码: {r.status_code}, 长度: {len(r.content)}')
    if r.status_code == 200 and len(r.content) > 1000:
        with open(OUT, 'wb') as f:
            f.write(r.content)
        w(f'已保存: {OUT}')
        # 挂到最新assistant消息
        from pymongo import MongoClient
        uri = None
        with open('/home/ubuntu/ai-companion/.env') as f:
            for line in f:
                if line.startswith('DATABASE_URL='):
                    uri = line.split('=',1)[1].strip()
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        db = client.get_default_database()
        msgs = db['messages']
        latest = msgs.find_one({'role':'assistant'}, sort=[('timestamp',-1)])
        if latest:
            msgs.update_one({'_id':latest['_id']}, {'$set':{'voice':'/voices/lumi_flirt.wav'}})
            w(f'已挂载到消息: {latest["content"][:20]}')
    else:
        w(f'生成失败: {r.text[:200]}')
except Exception as e:
    w(f'异常: {e}')
w('结束')
