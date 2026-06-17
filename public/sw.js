// HAK61 service worker.
// Installable PWA + best-effort Background Sync trigger for the offline queue.
// The actual replay happens in the client (IndexedDB queue flushed on the
// `online` event or when this SW posts a `hak-flush` message), which keeps
// Next.js server actions / auth working correctly.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", () => {
  // Network passthrough — no caching, to keep auth and RSC flows correct.
});

self.addEventListener("sync", (event) => {
  if (event.tag === "hak-flush") {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "hak-flush" });
        }
      })
    );
  }
});
