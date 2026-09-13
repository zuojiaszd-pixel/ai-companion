// Lumi语音条模块 v4：直连GPT-SoVITS推理服务(9880)，不再经过17777中间商
// 约定：回复末尾带 [voice]想说的内容[/voice] 就发语音条（独立消息，不复述文字）
// 9880返回wav二进制流，这里存到frontend/voices/并返回URL，前端直接播
// v4改动：①超时45秒→90秒（给单线程9880留足排队+合成时间）②语音内容限长24字→16字（短句更快出）
//         ③加单飞锁：同一时间只允许一个语音请求，防止并发请求把9880单线程堵死

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TTS_URL = 'http://127.0.0.1:9880/tts';
const REF_AUDIO = '/home/ubuntu/GPT-SoVITS/refs/t4.wav';
const PROMPT_TEXT = 'I keep telling myself that this is just a dream, but it feels so real.';
const VOICES_DIR = path.join(__dirname, '..', 'frontend', 'voices');
const MAX_VOICE_LEN = 25; // 语音内容最长16字，超出截断（短句秒出，长句必堵）
let voiceBusy = false; // 单飞锁：9880是单线程，同时只放一个请求进去

// 从回复中提取并剥离语音标记
function extractVoice(text) {
    if (!text) return { text: '', voice: null };
    const m = text.match(/\[voice\]([\s\S]*?)\[\/voice\]\s*$/);
    if (!m) return { text: text.trim(), voice: null };
    let voiceContent = m[1].trim();
    // 限长：截到16字，保证CPU推理能在90秒内完成
    if (voiceContent.length > MAX_VOICE_LEN) {
        console.log(`[语音条] 内容超长(${voiceContent.length}字)，截断到${MAX_VOICE_LEN}字`);
        voiceContent = voiceContent.slice(0, MAX_VOICE_LEN);
    }
    const cleanText = text.replace(/\[voice\][\s\S]*?\[\/voice\]/g, '').trim();
    return { text: cleanText, voice: voiceContent };
}

// 生成语音，返回URL路径（如 /voices/v_xxx.wav）；失败返回null（不影响文字消息）
async function generateVoice(content) {
    // 单飞锁：上一句还在合成就直接跳过，不排队堵死
    if (voiceBusy) {
        console.log('[语音条] 上一句还在合成，本条跳过（单飞锁）');
        return null;
    }
    voiceBusy = true;
    try {
        if (!fs.existsSync(VOICES_DIR)) fs.mkdirSync(VOICES_DIR, { recursive: true });
        const resp = await axios.post(TTS_URL, {
            text: content.slice(0, MAX_VOICE_LEN),
            text_lang: 'zh',
            ref_audio_path: REF_AUDIO,
            prompt_text: PROMPT_TEXT,
            prompt_lang: 'en'
        }, {
            timeout: 90000, // 90秒：短句10-30秒出，排队+合成都够；超时说明真堵死了，快速失败不卡聊天
            responseType: 'arraybuffer',
            headers: { 'Content-Type': 'application/json' }
        });
        // 9880成功返回RIFF wav二进制；失败时返回JSON错误文本
        const buf = Buffer.from(resp.data);
        if (!buf || buf.length < 1000 || buf.slice(0, 4).toString('ascii') !== 'RIFF') {
            throw new Error('TTS返回异常: ' + buf.slice(0, 120).toString('utf-8'));
        }
        const filename = 'v_' + Date.now() + '.wav';
        fs.writeFileSync(path.join(VOICES_DIR, filename), buf);
        const url = '/voices/' + filename;
        console.log(`[语音条] 生成成功: ${url} (${(buf.length / 1024).toFixed(1)}KB)`);
        return url;
    } catch (e) {
        console.error('[语音条] 生成失败:', e.message);
        return null;
    } finally {
        voiceBusy = false;
    }
}

module.exports = { extractVoice, generateVoice };
