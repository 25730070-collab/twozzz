/* map.js — 실제 지도(OpenStreetMap 타일 + Leaflet). 키가 필요 없다.
   Leaflet은 CDN에서 불러오고, 불러오지 못하면 null 을 돌려줘서 각 화면이 기존 대체 화면(약식 경로 그림·좌표)을 그대로 쓴다. */
const MAP_LIB = { css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' };
const RISK_COLOR = { 1: '#2e7d32', 2: '#f2c200', 3: '#ef7d1a', 4: '#c0282d' };
let _leaflet = null;

function loadLeaflet() {
  if (_leaflet) return _leaflet;
  _leaflet = new Promise(ok => {
    if (window.L) return ok(window.L);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = MAP_LIB.css; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = MAP_LIB.js;
    s.onload = () => ok(window.L || null); s.onerror = () => ok(null);
    setTimeout(() => ok(window.L || null), 8000);
    document.head.appendChild(s);
  });
  return _leaflet;
}

/* el 안에 지도를 만든다. 실패하면 null */
async function createMap(el, opts = {}) {
  const L = await loadLeaflet();
  if (!L) return null;
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, ...opts });
  map.attributionControl.setPrefix(false).setPosition('bottomleft');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  return { L, map };
}

/* 경로 + 사고 다발지점을 그린다 (예습 화면용, 움직이지 않는 지도) */
function drawRoute(m, route, onHazardClick) {
  const { L, map } = m;
  const line = L.polyline(route.path, { color: '#0b8457', weight: 6, opacity: .9, lineCap: 'round' }).addTo(map);
  L.circleMarker(route.path[0], { radius: 7, color: '#0b8457', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  L.circleMarker(route.path[route.path.length - 1], { radius: 7, color: '#c0282d', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  route.hazards.forEach(h => {
    const c = L.circleMarker([h.seg.lat, h.seg.lng], { radius: 8, color: '#fff', weight: 2, fillColor: RISK_COLOR[h.seg.riskLevel] || '#5b6560', fillOpacity: 1 }).addTo(map);
    if (onHazardClick) c.on('click', () => onHazardClick(h));
  });
  map.fitBounds(line.getBounds(), { padding: [28, 28] });
  return line;
}
