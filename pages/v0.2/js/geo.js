/* geo.js — 거리 · 방위 · 경로 위 위치 계산 (좌표는 [위도, 경도]) */
const EARTH = 6371000, rad = d => d * Math.PI / 180;

function hav(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
/* 점 사이를 step(m) 간격으로 촘촘하게 */
function densify(path, step = 40) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(hav(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
function cumulative(path) {
  const c = [0];
  for (let i = 1; i < path.length; i++) c.push(c[i - 1] + hav(path[i - 1], path[i]));
  return c;
}
/* 경로에서 점 p에 가장 가까운 꼭짓점 : {idx, dist(m), along(m)} */
function nearestOnPath(path, cum, p) {
  const kx = Math.cos(rad(p[0])), best = { idx: 0, d2: Infinity };
  for (let i = 0; i < path.length; i++) {
    const dx = (path[i][1] - p[1]) * kx, dy = path[i][0] - p[0], d2 = dx * dx + dy * dy;
    if (d2 < best.d2) { best.idx = i; best.d2 = d2; }
  }
  return { idx: best.idx, dist: hav(path[best.idx], p), along: cum[best.idx] };
}
/* 경로 시작에서 m미터 지점의 좌표 */
function pointAt(path, cum, m) {
  m = Math.max(0, Math.min(m, cum[cum.length - 1]));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; cum[mid] <= m ? lo = mid : hi = mid; }
  const span = cum[hi] - cum[lo] || 1, t = (m - cum[lo]) / span;
  return { pos: [path[lo][0] + (path[hi][0] - path[lo][0]) * t, path[lo][1] + (path[hi][1] - path[lo][1]) * t], idx: lo };
}
/* 위경도 → 지도용 미터 좌표(x 오른쪽, y 아래쪽) */
function toXY(lat0, lng0) {
  const kx = Math.cos(rad(lat0)) * 111320, ky = 110540;
  return p => [(p[1] - lng0) * kx, -(p[0] - lat0) * ky];
}
