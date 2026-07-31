/**
 * MCP 管理器 API 路由
 * 参考 kelivo MCP管理界面设计
 */
const express = require('express');
const router = express.Router();
const mcpManager = require('../services/mcpManager');

// GET /api/mcp — 服务器列表（含工具缓存状态）
router.get('/', (req, res) => {
    try {
        const servers = mcpManager.getServers();
        const toolCache = mcpManager.getToolCache();
        res.json(servers.map(s => ({
            ...s,
            toolCount: (toolCache[s.name] || []).length
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/mcp — 新增服务器
router.post('/', async (req, res) => {
    try {
        const server = mcpManager.addServer(req.body);
        // 后台刷新工具注册（不阻塞响应）
        mcpManager.reloadMcpTools().catch(e => console.error('[MCP] reload失败:', e.message));
        res.json(server);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PUT /api/mcp/:name — 更新服务器
router.put('/:name', async (req, res) => {
    try {
        const server = mcpManager.updateServer(req.params.name, req.body);
        mcpManager.reloadMcpTools().catch(e => console.error('[MCP] reload失败:', e.message));
        res.json(server);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/mcp/:name — 删除服务器
router.delete('/:name', async (req, res) => {
    try {
        mcpManager.removeServer(req.params.name);
        mcpManager.reloadMcpTools().catch(e => console.error('[MCP] reload失败:', e.message));
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/mcp/:name/test — 测试连接
router.post('/:name/test', async (req, res) => {
    try {
        const server = mcpManager.getServer(req.params.name);
        if (!server) throw new Error(`MCP服务器不存在: ${req.params.name}`);
        // 支持传入临时配置测试（未保存的新配置）
        const testServer = req.body && req.body.url ? { ...server, ...req.body } : server;
        const result = await mcpManager.testConnection(testServer);
        res.json(result);
    } catch (e) {
        res.status(400).json({ ok: false, error: e.message });
    }
});

// GET /api/mcp/:name/tools — 该服务器的工具列表
router.get('/:name/tools', async (req, res) => {
    try {
        const server = mcpManager.getServer(req.params.name);
        if (!server) throw new Error(`MCP服务器不存在: ${req.params.name}`);
        const result = await mcpManager.testConnection(server);
        res.json(result.tools);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// GET /api/mcp/config — 完整配置（含globalTimeout）
router.get('/config', (req, res) => {
    try {
        res.json(mcpManager.getConfig());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/mcp/config — 更新全局配置
router.put('/config', (req, res) => {
    try {
        const cfg = mcpManager.getConfig();
        if (req.body.globalTimeout !== undefined) {
            cfg.globalTimeout = req.body.globalTimeout;
            mcpManager.getConfig().globalTimeout = cfg.globalTimeout;
            // 同步给没有单独设置timeout的服务器
            cfg.servers.forEach(s => {
                if (!s.timeout) s.timeout = cfg.globalTimeout;
            });
        }
        // 保存
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(__dirname, '..', 'config', 'mcp_servers.json'), JSON.stringify(cfg, null, 2), 'utf-8');
        res.json({ ok: true, config: cfg });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/mcp/reload — 手动重载工具注册
router.post('/reload', async (req, res) => {
    try {
        const tools = await mcpManager.reloadMcpTools();
        res.json({ ok: true, toolCount: tools.length, tools: tools.map(t => t.function.name) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
