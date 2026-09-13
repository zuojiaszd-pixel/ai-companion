const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const META_FILE = path.join(UPLOAD_DIR, 'meta.json');
function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

// 允许的扩展名
const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.txt', '.md', '.zip', '.csv', '.xlsx', '.ppt', '.pptx'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

// 上传文件（JSON base64，跟图片走一样的通道，避免multipart依赖）
router.post('/files', (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: '缺少文件名或内容' });
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return res.status(400).json({ error: `不支持的文件类型: ${ext}，支持: ${ALLOWED_EXT.join(' ')}` });
    }
    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > MAX_SIZE) return res.status(400).json({ error: '文件超过50MB限制' });

    const id = crypto.randomBytes(8).toString('hex') + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);

    const meta = loadMeta();
    meta[id] = { name, size: buf.length, uploadedAt: new Date().toISOString() };
    saveMeta(meta);

    res.json({ id, name, size: buf.length, url: `/api/files/${id}` });
  } catch (e) {
    res.status(500).json({ error: '上传失败: ' + e.message });
  }
});

// 下载文件
router.get('/files/:id', (req, res) => {
  try {
    const id = req.params.id;
    const ext = path.extname(id).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return res.status(400).json({ error: '非法文件' });
    const filePath = path.join(UPLOAD_DIR, path.basename(id));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    const meta = loadMeta()[id] || {};
    const mimeMap = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain', '.zip': 'application/zip', '.csv': 'text/csv' };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(meta.name || id)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: '下载失败: ' + e.message });
  }
});

// 文件列表
router.get('/files', (req, res) => {
  const meta = loadMeta();
  res.json(Object.entries(meta).map(([id, m]) => ({ id, ...m, url: `/api/files/${id}` })));
});

// 删除文件
router.delete('/files/:id', (req, res) => {
  try {
    const id = req.params.id;
    const filePath = path.join(UPLOAD_DIR, path.basename(id));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const meta = loadMeta();
    delete meta[id];
    saveMeta(meta);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败: ' + e.message });
  }
});

module.exports = router;
