// App-shell cache for offline access and installability. Network-first, not cache-first: this is
// a single evolving index.html with no versioned build output, so a cache-first strategy would
// leave installed users stuck on whatever they first loaded. Bump CACHE_NAME on real breaking
// changes if you ever need to force a clean slate — normal edits don't need that, the network-first
// fetch handler already re-caches the latest response on every successful load.
const CACHE_NAME = "stakrabbit-shell-v1";
const SHELL_URLS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Only same-origin GET requests are handled here — relay websockets never go through fetch at
// all, and cross-origin calls (Nostr relays' HTTP fallbacks, Nominatim, Blossom, ipapi.co,
// frankfurter.app, CARTO tiles, esm.sh scripts) pass straight through untouched rather than
// risking opaque-response caching weirdness.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html")))
  );
});
