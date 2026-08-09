/**
 * MCP Manager — 多MCP服务器统一管理
 * 负责：配置读写、连接握手、工具列表拉取、工具调用转发、动态注册到AI工具列表
 * 参考 kelivo 的 MCP 管理界面设计
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'mcp_servers.json');

// 默认配置
const DEFAULT_CONFIG = {
    globalTimeout: 30000,          // 全局默认超时(ms)
    servers: []
};

let config = null;
let toolCache = {};  // serverName -> tools[] (转换后的OpenRouter格式)

// ---------- 配置读写 ----------
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        } else {
            config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            saveConfig();
        }
    } catch (e) {
        console.error('[MCP] 配置文件读取失败，用默认配置:', e.message);
        config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return config;
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('[MCP] 配置保存失败:', e.message);
    }
}

function getConfig() {
    if (!config) loadConfig();
    return config;
}

function getServers() {
    return getConfig().servers;
}

function getServer(name) {
    return getServers().find(s => s.name === name);
}

/**
 * 将 headers 中的 "${ENV_NAME}" 占位符替换为环境变量值
 * 防止 token 等敏感信息明文写入被 git 跟踪的配置文件
 */
function resolveHeaders(headers = {}) {
    const resolved = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            const m = value.match(/^\$\{([A-Z0-9_]+)\}$/);
            if (m) {
                const envVal = process.env[m[1]];
                if (envVal) {
                    resolved[key] = envVal;
                } else {
                    console.warn(`[MCP] 环境变量 ${m[1]} 未设置，header ${key} 留空`);
                    resolved[key] = '';
                }
                continue;
            }
        }
        resolved[key] = value;
    }
    return resolved;
}

// ---------- MCP 协议调用 ----------
let reqId = 1;

/**
 * 向MCP服务器发JSON-RPC请求
 * @param {object} server - 服务器配置
 * @param {string} method - MCP方法名 (initialize / tools/list / tools/call)
 * @param {object} params - 参数
 */
async function mcpRequest(server, method, params = {}) {
    const timeout = server.timeout || getConfig().globalTimeout || 30000;
    const url = server.url;
    const headers = {
        'Content-Type': 'application/json',
        ...resolveHeaders(server.headers || {})
    };
    const body = {
        jsonrpc: '2.0',
        id: reqId++,
        method,
        params
    };
    try {
        const res = await axios.post(url, body, { headers, timeout });
        if (res.data && res.data.error) {
            throw new Error(`MCP错误(${server.name}): ${JSON.stringify(res.data.error)}`);
        }
        return res.data;
    } catch (e) {
        if (e.response) {
            throw new Error(`MCP请求失败(${server.name} ${method}): HTTP ${e.response.status} ${JSON.stringify(e.response.data || '').slice(0, 300)}`);
        }
        throw new Error(`MCP请求失败(${server.name} ${method}): ${e.message}`);
    }
}

// ---------- 连接 & 工具 ----------
/**
 * 测试MCP服务器连接：initialize + tools/list
 */
async function testConnection(server) {
    const initRes = await mcpRequest(server, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Lumimi-MCP', version: '1.0.0' }
    });
    const serverInfo = initRes.result?.serverInfo || { name: server.name, version: '?' };

    const toolsRes = await mcpRequest(server, 'tools/list', {});
    const tools = toolsRes.result?.tools || [];

    return {
        ok: true,
        serverInfo,
        toolCount: tools.length,
        tools: tools.map(t => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || {}
        }))
    };
}

/**
 * 调用MCP服务器上的工具
 * @param {string} serverName - 服务器名（配置里的name）
 * @param {string} toolName - 工具名
 * @param {object} args - 工具参数
 */
async function callTool(serverName, toolName, args = {}) {
    const server = getServer(serverName);
    if (!server) throw new Error(`MCP服务器不存在: ${serverName}`);
    if (!server.enabled) throw new Error(`MCP服务器已停用: ${serverName}`);

    const res = await mcpRequest(server, 'tools/call', { name: toolName, arguments: args });
    const content = res.result?.content;
    if (Array.isArray(content)) {
        return content.map(c => c.text || JSON.stringify(c)).join('\n');
    }
    return JSON.stringify(res.result);
}

// ---------- 动态注册到AI工具列表 ----------
/**
 * 将MCP工具转换成OpenRouter function calling格式
 * 命名规则：mcp_<服务器名>_<工具名>
 */
async function buildAllTools() {
    const servers = getServers().filter(s => s.enabled);
    const allTools = [];
    toolCache = {};

    for (const server of servers) {
        try {
            const info = await testConnection(server);
            toolCache[server.name] = info.tools;
            const prefix = `mcp_${server.name}_`;
            for (const t of info.tools) {
                allTools.push({
                    type: 'function',
                    function: {
                        name: prefix + t.name,
                        description: `[MCP:${server.name}] ${t.description || t.name}`,
                        parameters: t.inputSchema || { type: 'object', properties: {} }
                    }
                });
            }
            console.log(`[MCP] ${server.name} 注册了 ${info.tools.length} 个工具`);
        } catch (e) {
            console.error(`[MCP] ${server.name} 连接失败，跳过:`, e.message);
        }
    }
    return allTools;
}

/**
 * 重新加载所有MCP工具（配置变更后调用）
 */
async function reloadMcpTools() {
    return await buildAllTools();
}

// ---------- CRUD ----------
function addServer(data) {
    const servers = getServers();
    if (servers.some(s => s.name === data.name)) {
        throw new Error(`MCP服务器名已存在: ${data.name}`);
    }
    const server = {
        name: data.name,
        description: data.description || '',
        type: data.type || 'http',          // http / sse
        url: data.url,
        headers: data.headers || {},
        timeout: data.timeout || getConfig().globalTimeout,
        enabled: data.enabled !== false
    };
    servers.push(server);
    saveConfig();
    return server;
}

function updateServer(name, data) {
    const server = getServer(name);
    if (!server) throw new Error(`MCP服务器不存在: ${name}`);
    if (data.name && data.name !== name) {
        if (getServer(data.name)) throw new Error(`MCP服务器名已存在: ${data.name}`);
        server.name = data.name;
    }
    if (data.description !== undefined) server.description = data.description;
    if (data.type !== undefined) server.type = data.type;
    if (data.url !== undefined) server.url = data.url;
    if (data.headers !== undefined) server.headers = data.headers;
    if (data.timeout !== undefined) server.timeout = data.timeout;
    if (data.enabled !== undefined) server.enabled = data.enabled;
    saveConfig();
    return server;
}

function removeServer(name) {
    const servers = getServers();
    const idx = servers.findIndex(s => s.name === name);
    if (idx === -1) throw new Error(`MCP服务器不存在: ${name}`);
    servers.splice(idx, 1);
    delete toolCache[name];
    saveConfig();
}

// ---------- 初始化 ----------
loadConfig();
buildAllTools().then(tools => {
    console.log(`[MCP] 初始化完成，共 ${tools.length} 个MCP工具可用`);
}).catch(e => {
    console.error('[MCP] 初始化失败:', e.message);
});

module.exports = {
    getConfig,
    getServers,
    getServer,
    addServer,
    updateServer,
    removeServer,
    testConnection,
    callTool,
    buildAllTools,
    reloadMcpTools,
    getToolCache: () => toolCache
};
