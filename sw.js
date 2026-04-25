// Service worker for Finnish Drill.
//
// Strategy:
//   - Install: precache the app shell + data + config + icon.
//   - Activate: delete any older caches (so deploys evict stale files).
//   - Fetch: cache-first for same-origin GET; fall back to network; update the
//     cache on successful network hits so icons/sounds we didn't precache
//     still come back offline after a first view.
//
// ⚠️ BUMP `CACHE_VERSION` whenever you ship app-shell changes that users need
//    to pick up. Without a bump, they'll keep the old cached files forever.

const CACHE_VERSION = "finnish-drill-v1.1.1";

// Files required for the app to boot offline. Paths are relative so this
// works under any base path (e.g. GitHub Pages project site).
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/main.js",
  "./js/config.js",
  "./js/data.js",
  "./js/drill.js",
  "./js/labels.js",
  "./js/filters.js",
  "./js/presets.js",
  "./js/settings.js",
  "./js/storage.js",
  "./js/stats.js",
  "./js/stats_ui.js",
  "./js/srs.js",
  "./js/blitz.js",
  "./js/tts.js",
  "./js/theme.js",
  "./js/streak.js",
  "./js/version.js",
  "./config/noun_cases.json",
  "./config/noun_groups.json",
  "./config/verb_forms.json",
  "./config/verb_groups.json",
  "./data/nouns.json",
  "./data/verbs.json",
  "./data/blocklist.json",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll rejects the whole batch if any request fails (e.g. icon PNGs
      // the user hasn't generated yet). Fall back to per-file add so a single
      // miss doesn't tank the install.
      return Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[sw] precache skip:", url, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Accept a skipWaiting nudge from the page. The page shows an "update
// available" banner when it detects a new worker in the `waiting` state;
// clicking the banner posts this message so we activate immediately instead
// of waiting for every tab to close. The page then reloads on controllerchange.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs — don't touch POSTs, TTS audio from CDN, etc.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Stash a copy of successful responses so subsequent offline loads work.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
