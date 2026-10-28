// The app's copy of itself, so it opens and works with no network: every
// file of this version is kept when it's installed, and answered from there.
// scripts/build-app.mjs fills in the version and the file list (each file's
// hash is part of the list, so any change makes a new version). A new version
// waits until every window of the app is closed (or "Restart now"), then
// replaces the old copy. Only the app's own files are kept: the backup folder
// is read through the File System Access API, never through here.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `ma-app-${VERSION}-__BUILD__`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map(([path]) => path))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('ma-app-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // viewer.html?library=1 is viewer.html.
    return (await cache.match(e.request, { ignoreSearch: true })) || fetch(e.request);
  })());
});
