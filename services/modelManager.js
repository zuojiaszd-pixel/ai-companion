/**
 * Model Manager — 模型统一管理
 * 参考 mcpManager.js 的设计：配置读写、模型增删改查、当前模型切换、连通性测试
 * 让 Rinka 可以在网页上自己加模型、切模型，不用每次改代码
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'models.json');

// 默认配置（迁移自 ai.js 硬编码）
const DEFAULT_CONFIG = {
    currentModel: "deepseek-v4-flash",
    models: [
        { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", provider: "deepseek", note: "老伙计" },
        { id: "glm-5.3-flash", name: "GLM 5.3 Flash", provider: "zhipu", note: "备用" }
    ]
};

let config = null;
let lastMtime = 0;  // 文件修改时间缓存，外部改文件也能感知

// ---------- 配置读写 ----------
function loadConfig(force = false) {
    try {
        const stat = fs.existsSync(CONFIG_PATH) ? fs.statSync(CONFIG_PATH) : null;
        const mtime = stat ? stat.mtimeMs : 0;
        // 缓存有效：非强制刷新 且 已加载 且 文件没变
        if (!force && config && mtime === lastMtime) return config;

        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        } else {
            config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            saveConfig();
        }
        lastMtime = mtime;
        // 兜底：currentModel 必须在 models 列表里，不在就回退到第一个
        if (!config.models.find(m => m.id === config.currentModel)) {
            if (config.models.length > 0) config.currentModel = config.models[0].id;
        }
    } catch (e) {
        console.error('[ModelManager] 配置文件读取失败，用默认配置:', e.message);
        config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return config;
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        lastMtime = fs.statSync(CONFIG_PATH).mtimeMs;
    } catch (e) {
        console.error('[ModelManager] 配置保存失败:', e.message);
        throw e;
    }
}

function getConfig() {
    return loadConfig();
}

// ---------- 查询 ----------
function getModels() {
    return getConfig().models;
}

function getCurrentModel() {
    return getConfig().currentModel;
}

function getModel(id) {
    return getModels().find(m => m.id === id);
}

// ---------- 变更 ----------
function addModel(data) {
    const config = getConfig();
    if (!data.id || typeof data.id !== 'string') throw new Error('模型 id 必填');
    const id = data.id.trim();
    if (config.models.find(m => m.id === id)) throw new Error(`模型 ${id} 已存在`);
    config.models.push({
        id,
        name: (data.name || id).trim(),
        provider: (data.provider || 'auto').trim(),   // deepseek / zhipu / openrouter / auto（按id猜）
        note: (data.note || '').trim()
    });
    // 第一次加模型且列表为空时自动设为当前
    if (!config.currentModel) config.currentModel = id;
    saveConfig();
    return getModel(id);
}

function updateModel(id, data) {
    const m = getModel(id);
    if (!m) throw new Error(`模型 ${id} 不存在`);
    if (data.name !== undefined) m.name = String(data.name).trim() || m.name;
    if (data.provider !== undefined) m.provider = String(data.provider).trim();
    if (data.note !== undefined) m.note = String(data.note).trim();
    saveConfig();
    return m;
}

function removeModel(id) {
    const config = getConfig();
    const idx = config.models.findIndex(m => m.id === id);
    if (idx < 0) throw new Error(`模型 ${id} 不存在`);
    if (config.currentModel === id) throw new Error('当前使用中的模型不能删，先切换到别的模型');
    config.models.splice(idx, 1);
    saveConfig();
    return true;
}

function setCurrentModel(id) {
    const config = getConfig();
    if (!config.models.find(m => m.id === id)) throw new Error(`模型 ${id} 不在列表里`);
    const prev = config.currentModel;
    config.currentModel = id;
    saveConfig();
    console.log(`[ModelManager] 模型切换: ${prev} -> ${id}`);
    return { previous: prev, current: id };
}

// ---------- 路由（provider -> url/key）----------
// 与 ai.js 的硬编码路由保持一致，provider=auto 时按 id 关键词猜
function resolveRoute(modelId) {
    const m = getModel(modelId);
    const provider = m && m.provider !== 'auto' ? m.provider : guessProvider(modelId);
    switch (provider) {
        case 'deepseek':
            return { url: 'https://api.deepseek.com/v1/chat/completions', key: process.env.DEEPSEEK_API_KEY };
        case 'zhipu':
            return { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: process.env.ZHIPUAI_API_KEY };
        default:
            return { url: 'https://openrouter.ai/api/v1/chat/completions', key: process.env.OPENROUTER_API_KEY };
    }
}

function guessProvider(modelId) {
    const id = (modelId || '').toLowerCase();
    if (id.indexOf('deepseek') >= 0) return 'deepseek';
    if (id.indexOf('glm') >= 0) return 'zhipu';
    return 'openrouter';
}

// ---------- 连通性测试 ----------
// 给模型发一句最小对话，验证 key/url/模型名三者都通
async function testModel(modelId) {
    const route = resolveRoute(modelId);
    if (!route.key) {
        return { ok: false, error: `没有对应的 API key（provider=${guessProvider(modelId)}），检查 .env 里的 ${guessProvider(modelId) === 'deepseek' ? 'DEEPSEEK_API_KEY' : guessProvider(modelId) === 'zhipu' ? 'ZHIPUAI_API_KEY' : 'OPENROUTER_API_KEY'}` };
    }
    try {
        const res = await axios.post(route.url, {
            model: modelId,
            messages: [{ role: 'user', content: '回复"在"一个字即可，测试连通性' }],
            max_tokens: 10
        }, {
            headers: { 'Authorization': 'Bearer ' + route.key, 'Content-Type': 'application/json' },
            timeout: 15000
        });
        const reply = res.data.choices?.[0]?.message?.content || '(空回复)';
        return { ok: true, reply: String(reply).slice(0, 50) };
    } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data?.error?.message || err.message;
        const hint = status === 401 ? 'key 无效' : status === 402 ? '余额不足' : status === 404 ? '模型名不对' : '';
        return { ok: false, error: `HTTP ${status || '???'} ${hint} ${detail}`.trim().slice(0, 200) };
    }
}

module.exports = {
    getModels, getCurrentModel, getModel,
    addModel, updateModel, removeModel, setCurrentModel,
    resolveRoute, guessProvider, testModel,
    loadConfig
};
