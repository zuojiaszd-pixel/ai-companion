#!/usr/bin/env python3
# 把direct_test.wav挂到最新一条assistant消息上（chats集合版）
import re
from pymongo import MongoClient

uri = None
with open('/home/ubuntu/ai-companion/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('DATABASE_URL='):
            uri = line.split('=', 1)[1]

client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client.get_default_database()
msgs = db['chats']  # 真正的聊天集合

# 找有voice字段的消息，学习格式
ref = msgs.find_one({'role': 'assistant', 'voice': {'$exists': True, '$ne': None}}, sort=[('timestamp', -1)])
if ref:
    print('参考voice格式:', ref.get('voice'))
    v = ref['voice']
    if isinstance(v, str) and '.wav' in v:
        new_v = re.sub(r'[^/]+\.wav$', 'direct_test.wav', v)
    else:
        new_v = '/voices/direct_test.wav'
else:
    new_v = '/voices/direct_test.wav'
    print('没有参考，用默认格式')

# 挂到最新一条assistant消息
latest = msgs.find_one({'role': 'assistant'}, sort=[('timestamp', -1)])
if latest:
    print('目标消息:', latest['content'][:30])
    msgs.update_one({'_id': latest['_id']}, {'$set': {'voice': new_v}})
    print('已挂载:', new_v)
else:
    print('没找到assistant消息')
