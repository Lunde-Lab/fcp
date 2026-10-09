// S-92 FCP – offline cache. Viser lagret versjon straks og henter ny i bakgrunnen.
const VERSION = "20261009110138";
const CACHE = "fcp-" + VERSION;
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "figures/fig1.png", "figures/fig2.png", "figures/fig3.png", "figures/fig4.png"];

// Originalsidene (pages/p001–p114.png, ~6 MB) ligger i en egen cache som overlever nye versjoner.
// Siden ber om nedlasting (postMessage "cache-pages") så "PDF" virker offline. Bump PAGECACHE hvis PDF-en endres.
const PAGECACHE = "fcp-pages-1";
const PAGES = Array.from({ length: 114 }, (_, i) => "pages/p" + String(i + 1).padStart(3, "0") + ".png");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
function cachePages() {
  return caches.open(PAGECACHE).then((c) => Promise.all(PAGES.map((p) => c.match(p).then((hit) => hit || c.add(p).catch(() => {})))));
}
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PAGECACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "cache-pages") e.waitUntil(cachePages()); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const u = new URL(req.url);
  const font = u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
  if (req.method !== "GET" || (u.origin !== location.origin && !font)) return;
  e.respondWith(
    caches.open(u.pathname.indexOf("/pages/") >= 0 ? PAGECACHE : CACHE).then((c) =>
      c.match(req, { ignoreSearch: true }).then((hit) => {
        const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
