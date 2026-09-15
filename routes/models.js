/**
 * 模型管理 API 路由
 * 参考 routes/mcp.js 设计
 * GET    /api/models          — 模型列表 + 当前模型
 * POST   /api/models          — 添加模型
 * PUT    /api/models/:id      — 更新模型信息
 * DELETE /api/models/:id      — 删除模型（使用中不可删）
 * POST   /api/models/switch   — 切换当前模型
 * POST   /api/models/:id/test — 连通性测试
 */
const express = require('express');
const router = express.Router();
const modelManager = require('../services/modelManager');

// GET /api/models — 列表
router.get('/', (req, res) => {
    try {
        res.json({
            current: modelManager.getCurrentModel(),
            models: modelManager.getModels()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/models — 添加
router.post('/', (req, res) => {
    try {
        const m = modelManager.addModel(req.body || {});
        res.json(m);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// PUT /api/models/:id — 更新
router.put('/:id', (req, res) => {
    try {
        const m = modelManager.updateModel(req.params.id, req.body || {});
        res.json(m);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// DELETE /api/models/:id — 删除
router.delete('/:id', (req, res) => {
    try {
        modelManager.removeModel(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/models/switch — 切换当前模型 { id }
router.post('/switch', (req, res) => {
    try {
        const id = (req.body && req.body.id || '').trim();
        if (!id) return res.status(400).json({ error: '缺少模型 id' });
        const result = modelManager.setCurrentModel(id);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/models/:id/test — 连通性测试
router.post('/:id/test', async (req, res) => {
    try {
        const result = await modelManager.testModel(req.params.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
