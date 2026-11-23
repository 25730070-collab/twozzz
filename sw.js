/* sw.js — 오프라인 지원 (서비스 워커)
   앱 화면 파일과 사고 데이터를 기기에 저장해 두었다가, 네트워크가 안 될 때 꺼내 쓴다.
   · 같은 사이트의 파일은 '네트워크 우선' : 연결되면 항상 최신 파일을 받아 저장하고(새 버전이 바로 보임), 끊기거나 4초 넘게 응답이 없으면 저장본을 쓴다.
   · 다른 사이트(카카오 길찾기·장소 검색, 지도 타일, Leaflet)는 건드리지 않는다. 그래서 오프라인에서는 경로 만들기와 실제 지도 타일은 되지 않는다.
   · 파일을 추가하면 아래 SHELL 에 넣고 VERSION 을 올린다. */
const VERSION = 'sd-v0.6-4';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'asset/icon-180.png',
  'asset/icon-192.png',
  'asset/icon-512.png',
  'pages/compare.html',
  'pages/data.html',
  'pages/detail.html',
  'pages/drive.html',
  'pages/list.html',
  'pages/my.html',
  'pages/preview.html',
  'pages/report.html',
  'pages/route.html',
  'pages/signup.html',
  'css/base.css',
  'css/components.css',
  'css/layout.css',
  'css/pages.css',
  'js/account.js',
  'js/common.js',
  'js/compare.js',
  'js/config.js',
  'js/data.js',
  'js/datapage.js',
  'js/detail.js',
  'js/drive.js',
  'js/geo.js',
  'js/home.js',
  'js/list.js',
  'js/map.js',
  'js/navinfo.js',
  'js/my.js',
  'js/preview.js',
  'js/report.js',
  'js/route-api.js',
  'js/route.js',
  'js/signup.js',
  'js/storage.js',
  'js/suggest.js',
  'data/segments_static.json',
  'data/segments_api.json',
  'data/segments.fallback.js',
  'data/pntfr_points.json',
  'data/speed_cameras.json',
  'data/data_manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));   // 없는 파일(예: config.local.js)이 있어도 나머지는 저장한다
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);   // 이전 버전 저장본 삭제
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin || u.pathname.includes('/api/')) return;      // 회원 서버(/api/)의 응답은 저장하지 않는다 (로그인 정보가 오래된 채로 남으면 안 되므로)
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const net = req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' });   // 화면 파일은 서버에 최신인지 확인하며 받는다
  try {
    const res = await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 4000))]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));   // 주소 뒤 ?origin=… 만 다른 화면은 같은 화면 파일로
    return hit || net;
  }
}
