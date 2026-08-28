@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在启动Lumi语音桥...
X:\runtime\python.exe -m pip install pyperclip sounddevice --quiet
X:\runtime\python.exe clipboard_tts.py
pause
