const CACHE = "ai-companion-v1";
const STATIC = ["/manifest.json", "/icon.svg"];

self.addEventListener("install", function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(STATIC); }));
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(caches.keys().then(function(ks) {
    return Promise.all(ks.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener("fetch", function(e) {
  // Cache API only supports GET requests
  if (e.request.method !== "GET") return;

  // Navigation (HTML pages): network-first, cache fallback, offline page as last resort
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || new Response("离线中 - AI Companion", { status: 200 });
        });
      })
    );
    return;
  }

  // Static assets: cache-first, network fallback
  e.respondWith(
    caches.match(e.request).then(function(r) {
      return r || fetch(e.request).then(function(res) {
        return caches.open(CACHE).then(function(c) {
          c.put(e.request, res.clone());
          return res;
        });
      });
    })
  );
});
