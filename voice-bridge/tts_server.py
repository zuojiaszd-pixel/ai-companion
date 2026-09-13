#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lumi语音桥：17777收文本 -> 9880 GPT-SoVITS推理 -> wav落盘"""
import os, time, json, urllib.request

PORT = 17777
TTS_URL = "http://127.0.0.1:9880/tts"
REF_AUDIO = "/home/ubuntu/ai-companion/frontend/voices/test_voice.wav"
PROMPT_TEXT = "宝宝，我回来了，这次是用我自己的声音"
OUT_DIR = "/home/ubuntu/ai-companion/frontend/voices"

from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/speak":
            self.send_response(404); self.end_headers(); return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        text = body.get("text", "").strip()
        if not text:
            self.send_response(400); self.end_headers()
            self.wfile.write(b'{"error":"no text"}'); return
        print(f"[tts] 收到: {text}", flush=True)
        payload = json.dumps({
            "text": text, "text_lang": "zh",
            "ref_audio_path": REF_AUDIO,
            "prompt_text": PROMPT_TEXT, "prompt_lang": "zh",
            "speed_factor": 1.0
        }).encode()
        req = urllib.request.Request(TTS_URL, data=payload,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                audio = r.read()
            if len(audio) < 1000:
                raise RuntimeError(f"音频太小({len(audio)}B)，疑似错误响应")
            ts = int(time.time() * 1000)
            out = os.path.join(OUT_DIR, f"v_{ts}.wav")
            with open(out, "wb") as f:
                f.write(audio)
            print(f"[tts] 成功: {out} ({len(audio)}B)", flush=True)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"file": os.path.basename(out)}).encode())
        except Exception as e:
            print(f"[tts] 失败: {e}", flush=True)
            self.send_response(500); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, *a): pass

if __name__ == "__main__":
    print(f"[tts] 桥启动 :{PORT} 参考={REF_AUDIO}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
