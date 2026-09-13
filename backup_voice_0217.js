// Lumi语音条模块：调GPT-SoVITS TTS服务，生成独立语音条消息
// 约定：回复末尾带 [voice]想说的内容[/voice] 就发语音条（独立消息，不复述文字）

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TTS_URL = 'http://127.0.0.1:9880/tts';
const VOICE_DIR = path.join(__dirname, '../frontend/voice');
const REF_AUDIO = '/home/ubuntu/GPT-SoVITS/Output/lumi_first_word.wav';

if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });

// 从回复中提取并剥离语音标记
function extractVoice(text) {
    if (!text) return { text: '', voice: null };
    const m = text.match(/\[voice\]([\s\S]*?)\[\/voice\]/);
    if (!m) return { text: text.trim(), voice: null };
    const voiceContent = m[1].trim();
    const cleanText = text.replace(/\[voice\][\s\S]*?\[\/voice\]/g, '').trim();
    return { text: cleanText, voice: voiceContent };
}

// 生成语音文件，返回文件名；失败返回null（不影响文字消息）
async function generateVoice(content) {
    const ts = Date.now();
    const filename = `lumi_v_${ts}.wav`;
    const outPath = path.join(VOICE_DIR, filename);
    try {
        const resp = await axios.post(TTS_URL, {
            text: content,
            text_lang: 'zh',
            ref_audio_path: REF_AUDIO,
            prompt_text: '',
            prompt_lang: 'zh',
            text_split_method: 'cut5'
        }, {
            responseType: 'arraybuffer',
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' }
        });
        fs.writeFileSync(outPath, resp.data);
        // 验证文件头是RIFF
        const head = fs.readFileSync(outPath).slice(0, 4).toString();
        if (head !== 'RIFF') throw new Error('非WAV文件');
        const size = fs.statSync(outPath).size;
        if (size < 2000) throw new Error('音频太小');
        console.log(`[语音条] 生成成功: ${filename} (${(size/1024).toFixed(1)}KB)`);
        return filename;
    } catch (e) {
        console.error('[语音条] 生成失败:', e.message);
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
        return null;
    }
}

module.exports = { extractVoice, generateVoice };
