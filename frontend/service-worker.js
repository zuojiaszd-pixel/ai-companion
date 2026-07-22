const CACHE = "ai-companion-v1";
const URLS = [".", "/manifest.json", "/icon.svg"];

self.addEventListener("install", function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(URLS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(caches.keys().then(function(ks) {
    return Promise.all(ks.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener("fetch", function(e) {
  e.respondWith(caches.match(e.request).then(function(r) {
    return r || fetch(e.request).then(function(res) {
      if (res && res.ok && e.request.method === "GET") {
        var copy = res.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
      }
      return res;
    });
  }));
});
