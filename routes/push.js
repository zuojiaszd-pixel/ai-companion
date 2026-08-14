/**
 * routes/push.js - Web Push 订阅管理
 * 走主 API 的 Bearer Token 鉴权（server.js 里 /api 前缀已挂鉴权中间件）
 * 订阅信息存本地文件 data/push-subscriptions.json（重启不丢）
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const router = express.Router();

const SUB_FILE = path.join(__dirname, '..', 'data', 'push-subscriptions.json');

// VAPID 配置（.env 里读）
const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:rinka@lumi.love';

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
}

function loadSubs() {
  try {
    if (fs.existsSync(SUB_FILE)) {
      return JSON.parse(fs.readFileSync(SUB_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('[Push] 读取订阅文件失败:', e.message);
  }
  return [];
}

function saveSubs(subs) {
  const dir = path.dirname(SUB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SUB_FILE, JSON.stringify(subs, null, 2));
}

// GET /api/push/status - 查询推送配置状态
router.get('/push/status', (req, res) => {
  const subs = loadSubs();
  res.json({
    configured: !!(vapidPublic && vapidPrivate),
    publicKey: vapidPublic || null,
    subscribed: subs.length > 0,
    count: subs.length
  });
});

// POST /api/push/subscribe - 保存订阅
// body: { subscription: {...} }
router.post('/push/subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: '缺少 subscription' });
  }
  if (!vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: '服务器未配置 VAPID 密钥' });
  }

  let subs = loadSubs();
  // 去重：同 endpoint 已存在则覆盖
  subs = subs.filter(s => s.endpoint !== subscription.endpoint);
  subs.push(subscription);
  saveSubs(subs);

  res.json({ success: true, count: subs.length });
});

// DELETE /api/push/subscribe - 删除订阅
// body: { endpoint } 或 query: ?endpoint=
router.delete('/push/subscribe', (req, res) => {
  const endpoint = (req.body && req.body.endpoint) || req.query.endpoint;
  if (!endpoint) return res.status(400).json({ error: '缺少 endpoint' });

  let subs = loadSubs();
  subs = subs.filter(s => s.endpoint !== endpoint);
  saveSubs(subs);
  res.json({ success: true, count: subs.length });
});

// POST /api/push/send - 发送一条推送（测试或 daemon 汇报用）
// body: { title?, body, url?, tag? }
router.post('/push/send', async (req, res) => {
  const { title, body, url, tag } = req.body;
  if (!body && !title) return res.status(400).json({ error: '标题和内容至少填一个' });

  const subs = loadSubs();
  if (subs.length === 0) {
    return res.status(400).json({ error: '还没有任何订阅，请先在网页上开启通知' });
  }
  if (!vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: '服务器未配置 VAPID 密钥' });
  }

  const payload = JSON.stringify({
    title: title || 'Lumi',
    body: body || '',
    url: url || '/',
    tag: tag || 'lumi-push'
  });

  const results = [];
  let validSubs = subs;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      results.push({ endpoint: sub.endpoint.slice(-20), ok: true });
    } catch (e) {
      // 410/404 = 订阅失效，删除
      if (e.statusCode === 410 || e.statusCode === 404) {
        validSubs = validSubs.filter(s => s.endpoint !== sub.endpoint);
      }
      results.push({ endpoint: sub.endpoint.slice(-20), ok: false, error: e.message });
    }
  }

  if (validSubs.length !== subs.length) saveSubs(validSubs);

  res.json({ success: results.some(r => r.ok), results });
});

module.exports = router;
