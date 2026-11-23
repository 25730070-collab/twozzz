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

/* el 안에 지도를 만든다. 실패하면 null
   opts.lite = true 이면 '페이지 안에 끼운 지도' : 터치 기기에서는 한 손가락 드래그를 지도가 가로채지 않고(화면 스크롤 우선),
   마우스 휠도 쓰지 않으며, 대신 확대·축소 버튼을 둔다. */
async function createMap(el, opts = {}) {
  const L = await loadLeaflet();
  if (!L) return null;
  const { lite, ...rest } = opts;
  const base = lite ? { dragging: !(L.Browser && L.Browser.mobile), scrollWheelZoom: false, zoomControl: true } : {};
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, ...base, ...rest });
  if (lite && map.zoomControl) map.zoomControl.setPosition('topright');
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

/* 사고 다발지점 점(마커) 하나 : 위험등급 색 + 흰 테두리. 누르면 이름·건수·상세 링크가 뜨는 말풍선 */
function hazardDot(m, seg, { radius = 7, current = false, layer = null } = {}) {
  const { L, map } = m;
  const c = L.circleMarker([seg.lat, seg.lng], { radius: current ? 11 : radius, color: '#fff', weight: current ? 3 : 2, fillColor: RISK_COLOR[seg.riskLevel] || '#5b6560', fillOpacity: 1 }).addTo(layer || map);
  if (!current) c.bindPopup(`<b>${esc(seg.roadName)}</b><br><span style="color:#5b6560">${seg.riskLevel}등급 · 사고 ${seg.accidentCount}건</span><br><a href="${segUrl(seg.segmentId)}" style="color:#0b8457;font-weight:700">자세히 보기</a>`, { closeButton: false, offset: [0, -4] });
  return c;
}

/* 경로 비교 지도 : 빠른 경로(남색)와 안전 경로(초록)를 겹쳐 그린다. 고른 쪽은 굵고 진하게, 다른 쪽은 얇고 흐리게.
   두 경로가 같으면 하나만 그린다. 반환: { update(type) } — 선택이 바뀔 때 부른다. 선(또는 점)을 누르면 onPick(type) */
const ROUTE_COLOR = { fast: '#3d5a80', safe: '#0b8457' };
function drawCompare(m, F, S, same, onPick) {
  const { L, map } = m;
  const items = same ? [['safe', S]] : [['fast', F], ['safe', S]];
  const lines = {};
  items.forEach(([type, r]) => {
    const casing = L.polyline(r.path, { color: '#fff', weight: 10, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    const line = L.polyline(r.path, { color: ROUTE_COLOR[type], weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    if (onPick) { casing.on('click', () => onPick(type)); line.on('click', () => onPick(type)); }
    lines[type] = { casing, line, ids: new Set(r.hazards.map(h => h.seg.segmentId)) };
  });
  const first = (same ? S : F).path;
  L.circleMarker(first[0], { radius: 7, color: '#0b8457', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  L.circleMarker(first[first.length - 1], { radius: 7, color: '#c0282d', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  const seen = new Map();                                   // 두 경로의 다발지점 합집합
  items.forEach(([, r]) => r.hazards.forEach(h => { if (!seen.has(h.seg.segmentId)) seen.set(h.seg.segmentId, h.seg); }));
  const dots = [...seen.values()].map(seg => ({ seg, c: hazardDot(m, seg, { radius: 8 }) }));
  const all = items.flatMap(([, r]) => r.path);
  map.fitBounds(L.latLngBounds(all), { padding: [28, 28] });
  const api = {
    update(sel) {
      const pick = lines[sel] ? sel : Object.keys(lines)[0];
      Object.entries(lines).forEach(([type, o]) => {
        const on = type === pick;
        o.casing.setStyle({ weight: on ? 10 : 7, opacity: on ? .95 : .6 });
        o.line.setStyle({ weight: on ? 6 : 4, opacity: on ? 1 : .55 });
      });
      if (lines[pick].casing.bringToFront) { lines[pick].casing.bringToFront(); lines[pick].line.bringToFront(); }
      dots.forEach(({ seg, c }) => {                         // 고른 경로가 지나지 않는 다발지점은 흐리게
        const on = lines[pick].ids.has(seg.segmentId);
        c.setStyle({ fillOpacity: on ? 1 : .3, opacity: on ? 1 : .5 });
        if (on && c.bringToFront) c.bringToFront();
      });
    }
  };
  return api;
}
