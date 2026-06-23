const CACHE_NAME = '3albalcon-v1';
const STATIC_ASSETS = [
  'https://www.3albalcon.com/'
];

// Install: cache homepage
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', event => {
  // Skip non-GET and cross-origin Firebase/API requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('anthropic.com') ||
      url.hostname.includes('script.google.com')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses from our domain
        if (response.ok && url.hostname.includes('3albalcon')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
