#!/usr/bin/env python3
# 诊断：摸清数据库真实结构 + 9880进程状态
import subprocess
from pymongo import MongoClient

out = []

# 1. 9880和3000端口监听状态
r = subprocess.run(['bash', '-c', "ss -tlnp 2>/dev/null | grep -E '9880|3000' || echo 端口都没监听"], capture_output=True, text=True)
out.append('[端口] ' + r.stdout.strip())

# 2. GPT-SoVITS相关进程
r = subprocess.run(['bash', '-c', "ps aux | grep -iE 'api|sovits' | grep -v grep | head -3 || echo 无进程"], capture_output=True, text=True)
out.append('[进程] ' + r.stdout.strip())

# 3. 数据库结构
uri = None
with open('/home/ubuntu/ai-companion/.env') as f:
    for line in f:
        line = line.strip()
        if line.startswith('DATABASE_URL='):
            uri = line.split('=', 1)[1]

client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client.get_default_database()
colls = db.list_collection_names()
out.append('[集合] ' + str(colls))

for c in colls:
    doc = db[c].find_one()
    if doc:
        out.append(f'[{c}字段] {list(doc.keys())}')
        # 打印最近2条看看role长什么样
        for d in db[c].find().sort('_id', -1).limit(2):
            keys = {k: (str(v)[:40]) for k, v in d.items() if k in ('role','sender','from','content','text','timestamp','voice')}
            out.append(f'  样本: {keys}')

with open('/home/ubuntu/ai-companion/voice-bridge/result2.txt', 'w') as f:
    f.write('\n'.join(out))
print('done')
