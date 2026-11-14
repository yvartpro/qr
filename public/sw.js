// Bump when the shell list changes. Static files refresh in the background anyway.
const CACHE = "giraso-qr-v1";

const SHELL = [
    "/",
    "/style.css",
    "/app.js",
    "/phone.js",
    "/countries.js",
    "/site.webmanifest",
    "/favicon-32x32.png",
    "/android-chrome-192x192.png",
    "/flags/BI.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

function isNeverCached(url) {
    return url.pathname.startsWith("/api/") || url.pathname.startsWith("/r/");
}

/** Pages: always try the network so content is fresh; fall back to the cached app when offline. */
async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    // Keyed by path only, so ?type=… or private tokens in the query never end up in the cache.
    const key = new URL(request.url).pathname;

    try {
        const response = await fetch(request);

        if (response.ok && !response.redirected) {
            cache.put(key, response.clone());
        }

        return response;
    } catch {
        return (await cache.match(key)) || cache.match("/");
    }
}

/** Static files: answer from cache instantly, then update it for next time. */
async function staleWhileRevalidate(event) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    const update = fetch(event.request)
        .then((response) => {
            if (response.ok) {
                cache.put(event.request, response.clone());
            }

            return response;
        })
        .catch(() => cached);

    if (cached) {
        event.waitUntil(update);
        return cached;
    }

    return update;
}

self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Cross-origin (Google Fonts) and anything dynamic go straight to the network.
    if (request.method !== "GET" || url.origin !== self.location.origin || isNeverCached(url)) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request));
        return;
    }

    event.respondWith(staleWhileRevalidate(event));
});
