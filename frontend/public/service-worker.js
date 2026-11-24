importScripts('/receipt-logo-path.js');
importScripts('/offline-navigation.js');

const CACHE_NAME = 'purebazar-pos-v2';
const POS_URL = '/orders/pos';
const PROFILE_CACHE = 'purebazar-offline-profile-v1';
const PROFILE_KEY = '/__purebazar_offline_profile__';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(POS_URL);
    if (!response.ok) throw new Error('POS page could not be cached for offline use.');
    const html = await response.clone().text();
    await cache.put(POS_URL, response);
    await cache.add('/receipt-logo-path.js');
    await cache.add(self.PUREBAZAR_RECEIPT_LOGO_PATH);
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin).href)
      .filter((asset, index, list) => list.indexOf(asset) === index);
    await Promise.all(assets.map(async (asset) => {
      const assetResponse = await fetch(asset);
      if (!assetResponse.ok) throw new Error(`POS asset could not be cached: ${asset}`);
      await cache.put(asset, assetResponse);
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
        const profileCache = await caches.open(PROFILE_CACHE);
        const storedProfile = await profileCache.match(new URL(PROFILE_KEY, self.location.origin));
        const profile = storedProfile ? await storedProfile.json() : null;
        const decision = self.decideOfflineNavigation(profile, Date.now(), url.href);
        if (decision.screen === 'pos') {
          if (decision.redirectTo) {
            return Response.redirect(new URL(decision.redirectTo, self.location.origin), 302);
          }
          return (await cache.match(POS_URL)) || offlinePage('Sign in required',
            'Your offline session has ended. Connect to the internet and sign in again to continue selling.');
        }
        if (decision.screen === 'sign-in-required') {
          return offlinePage('Sign in required',
            'Your offline session has ended. Connect to the internet and sign in again to continue selling.');
        }
        return offlinePage("You're offline", 'This page needs an internet connection.');
      }
    })());
  }
});

function offlinePage(title, message) {
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  return new Response(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)} - PureBazar</title><style>
    *{box-sizing:border-box}body{align-items:center;background:#f8fafc;color:#0f172a;display:flex;font:16px/1.5 system-ui,sans-serif;justify-content:center;margin:0;min-height:100vh;padding:24px}
    main{background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 12px 32px #0f172a12;max-width:500px;padding:36px;text-align:center;width:100%}
    h1{font-size:26px;margin:20px 0 8px}p{color:#475569;margin:0}.icon{align-items:center;background:#f1f5f9;border-radius:50%;color:#475569;display:flex;font-size:26px;height:56px;justify-content:center;margin:auto;width:56px}
    button{background:#047857;border:0;border-radius:9px;color:#fff;cursor:pointer;font:600 14px system-ui;margin-top:24px;padding:12px 22px}
    </style></head><body><main role="status"><div class="icon" aria-hidden="true">!</div>
    <h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
    <button type="button" onclick="location.reload()">Try again</button></main>
    <script>window.addEventListener('online',function(){location.reload()})</script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
