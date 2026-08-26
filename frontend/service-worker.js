// Lumi PWA - v3 推送版
// v2 是自我清理模式（unregister），无法承载 Web Push。
// v3 保留"全走网络、不缓存任何内容"的策略（防止旧页面缓存问题），
// 去掉 unregister，新增 push 事件监听，用于接收服务器推送通知。
const CACHE_NAME = "lumi-pwa-v5-final";

self.addEventListener("install", function(e) {
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      // v3 不卸载自己：推送通知需要 SW 常驻后台
      return self.clients.claim();
    })
  );
});

// 全部走网络，不缓存。若离线返回简单提示页。
self.addEventListener("fetch", function(e) {
  e.respondWith(
    fetch(e.request).catch(function() {
      if (e.request.mode === "navigate") {
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumi - 离线</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#fef6f8;color:#3d2c33;text-align:center;padding:20px}div{max-width:400px}h1{font-size:24px;margin-bottom:8px;color:#f5a0b8}p{font-size:14px;color:#8a6e7a;line-height:1.6}</style></head><body><div><h1>&#x1F31F; Lumi</h1><p>网络连接已断开<br>连上网络后刷新即可继续聊天</p></div></body></html>',
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
      return new Response("", { status: 503 });
    })
  );
});

// === Web Push 接收 ===
self.addEventListener("push", function(e) {
  let data = { title: "Lumi", body: "有新消息", url: "/" };
  try {
    if (e.data) {
      const parsed = e.data.json();
      if (parsed && typeof parsed === "object") {
        data = Object.assign(data, parsed);
      } else {
        data.body = e.data.text();
      }
    }
  } catch (err) {
    try { data.body = e.data ? e.data.text() : "有新消息"; } catch (_) {}
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "lumi-push",
      data: { url: data.url || "/" }
    })
  );
});

// 点击通知：聚焦或打开网页
self.addEventListener("notificationclick", function(e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list) {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
