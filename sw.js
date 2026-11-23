const CACHE = 'wnl-shell-1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './icons.js', './manifest.json', './favicon.svg', './favicon-mask.svg'];
const EXTRA = ['./mp3-encoder.js'];

self.addEventListener('install', function (e) {
e.waitUntil((async function () {
const c = await caches.open(CACHE);
for (const u of SHELL) { try { await c.add(new Request(u, { cache: 'reload' })); } catch (err) {} }
for (const u of EXTRA) { try { const r = await fetch(u, { cache: 'reload' }); if (r && r.ok) await c.put(u, r); } catch (err) {} }
await self.skipWaiting();
})());
});

self.addEventListener('activate', function (e) {
e.waitUntil((async function () {
const keys = await caches.keys();
for (const k of keys) { if (k !== CACHE && k.indexOf('wnl-') === 0) await caches.delete(k); }
await self.clients.claim();
})());
});

self.addEventListener('message', function (e) {
if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
const req = e.request;
if (req.method !== 'GET') return;
let url;
try { url = new URL(req.url); } catch (err) { return; }
if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

if (req.mode === 'navigate') {
e.respondWith((async function () {
const c = await caches.open(CACHE);
try {
const res = await fetch(req);
if (res && res.ok) { try { await c.put('./index.html', res.clone()); } catch (err) {} }
return res;
} catch (err) {
const hit = await c.match('./index.html') || await c.match('./');
return hit || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
})());
return;
}

const same = url.origin === self.location.origin;
const encoder = url.pathname.indexOf('lame.min.js') >= 0 || url.pathname.indexOf('mp3-encoder.js') >= 0;
if (!same && !encoder) return;

if (encoder && !same) {
e.respondWith((async function () {
const c = await caches.open(CACHE);
const hit = await c.match(req);
if (hit) return hit;
try {
const res = await fetch(req);
if (res && (res.ok || res.type === 'opaque')) { try { await c.put(req, res.clone()); } catch (err) {} }
return res;
} catch (err) {
return new Response('', { status: 504 });
}
})());
return;
}

e.respondWith((async function () {
const c = await caches.open(CACHE);
try {
const res = await fetch(req);
if (res && res.ok) { try { await c.put(req, res.clone()); } catch (err) {} }
return res;
} catch (err) {
const hit = await c.match(req) || await c.match(req, { ignoreSearch: true });
if (hit) return hit;
return new Response('', { status: 504 });
}
})());
});
