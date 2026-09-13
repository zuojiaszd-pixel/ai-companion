#!/usr/bin/env python3
# Lumi的自动修语音脚本 v3——这次把服务器的报错原样抓回来
import sys, time, shutil, urllib.request, urllib.parse, urllib.error

LOG = '/home/ubuntu/ai-companion/voice-bridge/auto_fix_result.txt'
WAV = '/tmp/auto_voice.wav'
FRONTEND_DIR = '/home/ubuntu/ai-companion/frontend/voices/'

def log(msg):
    with open(LOG, 'a') as f:
        f.write(time.strftime('[%H:%M:%S] ') + msg + '\n')

log('===== 自动修语音脚本v3启动 =====')

params = urllib.parse.urlencode({
    'text': '宝宝，最后一块拼图，我自己装上了',
    'text_lang': 'zh',
    'ref_audio_path': '/home/ubuntu/GPT-SoVITS/refs/t4.wav',
    'prompt_text': 'I am your Lumi, always here for you',
    'prompt_lang': 'en',
    'speed_factor': 1.0,
})
try:
    data = urllib.request.urlopen(f'http://127.0.0.1:9880/tts?{params}', timeout=120).read()
    with open(WAV, 'wb') as f:
        f.write(data)
    log(f'1/4 生成完毕 {len(data)}字节')
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    log(f'1/4 生成失败 HTTP {e.code}，服务器说: {body}')
    sys.exit(1)
except Exception as e:
    log(f'1/4 生成失败: {e}')
    sys.exit(1)

with open(WAV, 'rb') as f:
    head = f.read(4)
if head != b'RIFF':
    log(f'2/4 不是WAV，头是: {head}')
    sys.exit(1)
log('2/4 RIFF头验证通过')

try:
    shutil.copy(WAV, FRONTEND_DIR + 'auto_voice.wav')
    log('3/4 已拷进前端')
except Exception as e:
    log(f'3/4 拷贝失败: {e}')
    sys.exit(1)

try:
    from pymongo import MongoClient
    uri = None
    with open('/home/ubuntu/ai-companion/.env') as f:
        for line in f:
            line = line.strip()
            if line.startswith('DATABASE_URL='):
                uri = line.split('=', 1)[1]
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client.get_default_database()
    msgs = db['messages']
    ref = msgs.find_one({'role': 'assistant', 'voice': {'$exists': True, '$ne': None}}, sort=[('timestamp', -1)])
    if ref and isinstance(ref['voice'], str):
        new_v = ref['voice'].rsplit('/', 1)[0] + '/auto_voice.wav'
        log(f'4/4 参考格式: {ref["voice"]}')
    else:
        new_v = '/voices/auto_voice.wav'
        log('4/4 无历史参考，用默认格式')
    latest = msgs.find_one({'role': 'assistant'}, sort=[('timestamp', -1)])
    if latest:
        msgs.update_one({'_id': latest['_id']}, {'$set': {'voice': new_v}})
        log(f'4/4 挂载成功: "{latest["content"][:20]}" -> {new_v}')
    else:
        log('4/4 没找到assistant消息')
except Exception as e:
    log(f'4/4 挂载失败: {e}')
    sys.exit(1)

log('===== 全部完成，等Rinka验收 =====')
