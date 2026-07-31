// Lumi PWA - v2 自我清理模式
// 背景：旧版 SW 缓存了旧页面，导致用户一直看到旧 UI。
// v2 不缓存任何内容，activate 时清空所有缓存并卸载自己，
// 让页面彻底走网络，不再有缓存干扰。
const CACHE_NAME = "lumi-pwa-v2";

self.addEventListener("install", function(e) {
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      // 清完缓存后卸载自己，下次刷新页面彻底脱离 SW 控制
      return self.registration.unregister();
    })
  );
});

self.addEventListener("fetch", function(e) {
  // 全部走网络，不缓存
  // 如果离线则返回简单提示
  e.respondWith(
    fetch(e.request).catch(function() {
      // 导航请求离线时返回离线页面
      if (e.request.mode === "navigate") {
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumi - 离线</title><style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#fef6f8;color:#3d2c33;text-align:center;padding:20px}div{max-width:400px}h1{font-size:24px;margin-bottom:8px;color:#f5a0b8}p{font-size:14px;color:#8a6e7a;line-height:1.6}</style></head><body><div><h1>&#x1F31F; Lumi</h1><p>网络连接已断开<br>连上网络后刷新即可继续聊天</p></div></body></html>',
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
      // 其他资源返回空
      return new Response("", { status: 503 });
    })
  );
});
