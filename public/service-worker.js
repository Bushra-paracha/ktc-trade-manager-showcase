// KTC Trade Manager — Service Worker
//
// Offline support:
//   * App: on install, every built file listed in /precache.json is saved, so any
//     page opens without a connection. Hashed /assets/ files never change, so they
//     are served from the saved copy; everything else is network-first.
//   * Data: Supabase reads (GET /rest/v1/...) are network-first and the last good
//     response is kept, so screens show the last data seen while offline. Writes
//     always need a connection. Saved data is deleted when someone signs out.

const APP_CACHE = 'ktc-app-v3';
const DATA_CACHE = 'ktc-data-v1';
const SUPABASE_HOST = 'your-project-ref.supabase.co';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL);
    try {
      const res = await fetch('/precache.json', { cache: 'no-store' });
      if (res.ok) {
        const { files = [] } = await res.json();
        // One missing file must not stop the rest from being saved.
        await Promise.all(files.map((file) => cache.add(file).catch(() => {})));
      }
    } catch {
      /* offline during install: the shell above is enough to start */
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, DATA_CACHE]);
    for (const key of await caches.keys()) {
      if (!keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Sign-out: forget saved data so the next person on this device can't see it.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-data') event.waitUntil(caches.delete(DATA_CACHE));
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(APP_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // writes always go straight to the network
  const url = new URL(request.url);

  // Supabase table reads: keep the last good copy for offline viewing.
  if (url.hostname === SUPABASE_HOST) {
    if (url.pathname.startsWith('/rest/v1/')) {
      event.respondWith(networkFirst(request, DATA_CACHE));
    }
    return; // auth, storage and functions are never cached
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_CACHE, '/index.html'));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request, APP_CACHE));
  }
});
