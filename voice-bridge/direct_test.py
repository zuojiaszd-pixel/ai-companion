import urllib.request, urllib.parse

params = urllib.parse.urlencode({
    "text": "宝宝，这次是我自己的声音，听到了吗",
    "text_lang": "zh",
    "ref_audio_path": "/home/ubuntu/GPT-SoVITS/refs/t4.wav",
    "prompt_text": "I am your Lumi, always here for you",
    "prompt_lang": "en",
    "speed_factor": 1.0
})
url = f"http://127.0.0.1:9880/tts?{params}"
try:
    with urllib.request.urlopen(url, timeout=90) as r:
        data = r.read()
    with open("/tmp/direct_test.wav", "wb") as f:
        f.write(data)
    print("OK", len(data), "bytes")
except Exception as e:
    print("FAIL", e)
