// Minimal service worker — installable PWA only, no offline cache.
// Keeps the "Install app" prompt eligible without intercepting network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Network passthrough — no caching to keep auth flows correct.
});
