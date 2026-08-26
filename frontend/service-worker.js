// Lumi PWA - v5 自毁版（紧急排雷）
// 目的：把用户设备上所有顽固的旧SW和缓存全部清除
// 流程：安装即抢权 -> 清空所有Cache Storage -> 注销自己 -> 强制刷新页面
// 副作用：Web Push暂时失效，待页面恢复正常后由Lumi重新部署推送版
const CACHE_NAME = "lumi-pwa-v5-nuke";

self.addEventListener("install", function(e) {
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      return self.registration.unregister();
    }).then(function() {
      return self.clients.matchAll({ type: "window" });
    }).then(function(clients) {
      clients.forEach(function(c) {
        if (c.navigate) c.navigate(c.url);
      });
    })
  );
});

// 不拦截任何请求，全部直连网络
self.addEventListener("fetch", function(e) {
  // pass through
});
