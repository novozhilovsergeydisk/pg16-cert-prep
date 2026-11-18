/* Bump the shell version whenever a cached asset changes. */
const SHELL='pg16-shell-v8';
const ASSETS=['/','/index.html','/css/style.css','/js/accent.js','/js/ai.js','/js/app.js',
    '/js/offline-core.js','/js/offline.js','/favicon.svg','/manifest.webmanifest',
    '/icons/pwa-192.png','/icons/pwa-512.png','/icons/pwa-maskable-512.png'];
importScripts('/js/offline-core.js','/js/offline.js');
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(ASSETS)));});
// No skipWaiting: a running exercise keeps the shell that created it.
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith('pg16-shell-')&&key!==SHELL)await caches.delete(key);
    await self.clients.claim();
})());});
self.addEventListener('fetch',event=>{
    const url=new URL(event.request.url);
    if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
    if(event.request.mode==='navigate'){
        event.respondWith(caches.open(SHELL).then(cache=>cache.match('/')).then(cached=>cached || fetch(event.request)));return;
    }
    if(ASSETS.includes(url.pathname))event.respondWith(caches.open(SHELL).then(cache=>cache.match(url.pathname)).then(cached=>cached || fetch(event.request)));
});
self.addEventListener('sync',event=>{if(event.tag==='pg16-sync')event.waitUntil(self.PGOffline.background());});
