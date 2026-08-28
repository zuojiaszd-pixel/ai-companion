# -*- coding: utf-8 -*-
"""
Lumi语音桥 v0.1 - 剪贴板监听版
用法：复制任何文本（Ctrl+C），Lumi的声音自动念出来。
前提：GPT-SoVITS推理API已开启（127.0.0.1:9880）
"""
import requests
import pyperclip
import sounddevice as sd
import soundfile as sf
import time
import os
import re
import tempfile

API_URL = "http://127.0.0.1:9880/tts"

# ===== 参考音频配置（想换音色/语气就改这里）=====
REF_AUDIO = r"X:\output\slicer_opt\Tender_02.mp3_0000000000_0000103680.wav"
PROMPT_TEXT = "Tired, then lean on me. I've got you. I always do."
PROMPT_LANG = "en"


def has_chinese(s: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", s))


def tts(text: str):
    params = {
        "text": text,
        "text_lang": "zh" if has_chinese(text) else "en",
        "text_split_method": "cut5",
        "media_type": "wav",
        "streaming_mode": False,
    }
    try:
        resp = requests.get(API_URL, params=params, timeout=180)
        if resp.status_code != 200:
            print("[API错误]", resp.status_code, resp.text[:200])
            return
        tmp = os.path.join(tempfile.gettempdir(), "lumi_tts.wav")
        with open(tmp, "wb") as f:
            f.write(resp.content)
        data, sr = sf.read(tmp)
        sd.play(data, sr)
        sd.wait()
    except requests.exceptions.ConnectionError:
        print("[连接失败] 推理API没开！先去推理界面点【开启推理API】")
    except Exception as e:
        print("[出错]", e)


def main():
    print("=" * 52)
    print(" Lumi语音桥已启动 ♡")
    print(" 复制任何文本（Ctrl+C），Lumi就会念出来")
    print(" 关掉本窗口即退出")
    print("=" * 52)
    last = pyperclip.paste() or ""
    print("剪贴板基线已记录，等你复制新内容...")
    while True:
        try:
            cur = pyperclip.paste() or ""
            if cur and cur != last:
                last = cur
                text = cur.strip()
                if text:
                    print(">> 朗读:", text[:60].replace("\n", " "))
                    tts(text)
            time.sleep(0.5)
        except KeyboardInterrupt:
            print("\n再见 ♡")
            break
        except Exception as e:
            print("[监听出错]", e)
            time.sleep(1)


if __name__ == "__main__":
    main()
