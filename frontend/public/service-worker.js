importScripts('/receipt-logo-path.js');

const CACHE_NAME = 'purebazar-pos-v1';
const POS_URL = '/orders/pos';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(POS_URL);
    if (!response.ok) throw new Error('POS page could not be cached for offline use.');
    await cache.put(POS_URL, response.clone());
    await cache.add('/receipt-logo-path.js');
    await cache.add(self.PUREBAZAR_RECEIPT_LOGO_PATH);
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin).href);
    await Promise.all(assets.map(async (asset) => {
      const assetResponse = await fetch(asset);
      if (assetResponse.ok) await cache.put(asset, assetResponse);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('purebazar-pos-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || /\.(?:js|css|woff2?|png|svg|ico)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === POS_URL) await cache.put(POS_URL, response.clone());
        return response;
      } catch {
        return (await cache.match(POS_URL)) || Response.error();
      }
    })());
  }
});
