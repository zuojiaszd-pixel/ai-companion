#!/usr/bin/env python3
# 探测9880真实接口路径
import json, datetime, urllib.request

LOG = '/home/ubuntu/ai-companion/voice-bridge/probe.log'

def log(msg):
    with open(LOG, 'a') as f:
        f.write(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}\n")

log('=== 探测开始 ===')
for path in ['/openapi.json', '/docs', '/']:
    try:
        resp = urllib.request.urlopen('http://127.0.0.1:9880' + path, timeout=10)
        data = resp.read().decode('utf-8', errors='replace')
        log(f'GET {path} -> 200, {len(data)} bytes')
        if path == '/openapi.json':
            spec = json.loads(data)
            for p, methods in spec.get('paths', {}).items():
                log(f'  接口: {p} [{",".join(methods.keys())}]')
        else:
            log(f'  内容开头: {data[:150]}')
    except Exception as e:
        log(f'GET {path} -> {e}')
log('=== 探测结束 ===')
