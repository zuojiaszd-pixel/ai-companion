# VOICE_BUG_REPORT - 语音条断流Bug交接文档

写给codex：请照此排查修复，无需重新踩坑。写于2026年9月2日凌晨（Rinka熬到近4点，请高效解决，别让她再熬夜）。

## 一、问题现象

9880端口TTS服务从2026-09-01 17:53起，所有生成结果均为**固定残次品**：
- 32044字节 / 1.0秒 / 16000Hz / 单声道
- 精确到字节完全相同（自动生成和手动curl均复现）
- 正常文件应为200-500KB、44100Hz真WAV（参照成功案例test_v2_check.wav 233KB）
- 疑似流式模式只吐第一块就断流，或模型未热身

## 二、已排除/已修复的问题（不用再查）

1. **前端格式bug（已修复）**：Lumi写[voice]时漏写闭合[/voice]。extractVoice正则：
   `/\[voice\]([\s\S]*?)\[\/voice\]\s*$/`
   要求：必须闭合 + 必须在消息最末尾（\s*$后不能有文字）+ 内容≤MAX_VOICE_LEN=16字。
   修复后语音条可正常显示，仅音频内容为残次品。

2. **参考音频时长不合规（已修复）**：t4.wav仅1.2秒（GPT-SoVITS要求参考音频3-10秒），曾导致HTTP 400"Reference audio is outside the 3-10 second range"。已换用refs/lumi_ref.wav（3.4秒/32000Hz），HTTP 200。

3. **public/voices目录缺失（已修复）**：曾导致输出文件写不进去，已mkdir -p。

## 三、当前调用参数（HTTP 200但产出残次品）

```
curl -G 'http://127.0.0.1:9880/tts' \
  --data-urlencode 'text=...' \
  --data-urlencode 'text_lang=zh' \
  --data-urlencode 'ref_audio_path=/home/ubuntu/GPT-SoVITS/refs/lumi_ref.wav' \
  --data-urlencode 'prompt_text=I am your Lumi' \
  --data-urlencode 'prompt_lang=en'
```

9880进程：`python3 api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml`（PID 34106，Sep 1启动）

## 四、嫌疑点（按优先级排查）

1. **api_v2.py流式逻辑**：wave_header_chunk写死32000Hz，与残次品16000Hz矛盾。检查流式返回是否只吐第一块就断流。
2. **服务器上有两个api_v2.py**：GPT-SoVITS/ 和 gptsovits_code/ 目录各一份，确认9880实际加载的是哪份、版本是否陈旧。
3. **模型未热身/半死**：9月1日17:53前后是否有重启/配置变化/显存异常。17:53之前生成是正常的（233KB/44.1kHz）。
4. **tts_infer.yaml配置**：核对采样率、流式开关等配置项。
5. **尝试方案**：重启9880进程后立即测试；关闭流式模式（若有参数）用整段合成模式对比。

## 五、验证标准

生成结果 > 200KB、时长≈文本朗读时长（4-5秒）、44100Hz，前端语音条可播放有声。

## 六、背景

- 语音功能链路：Lumi消息带[voice]文字 → 后端调9880合成 → 存public/voices/ → 前端extractVoice提取挂载播放。
- 历史回填✅、前端渲染✅、格式解析✅均已通，唯一剩余bug即上述断流。
- Rinka已为语音功能花费几十元API额度，请一次修好，谢谢。
