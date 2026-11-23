/* navinfo.js — 안내 화면에서 쓰는 계산 모음 (화면 요소를 건드리지 않아서 따로 시험할 수 있다)
   · 남은 시간 : 카카오 길찾기가 도로마다 준 소요 시간(roads.duration)을 합쳐서 계산. 도로 정보가 없으면 거리 비율로 어림한다
   · 교통 막대 : 도로마다의 교통 상태(traffic_state)를 경로 위치에 맞춰 이어 붙인 것. '길찾기를 요청한 시점'의 정보다
   · 단속 카메라 : data/speed_cameras.json (공공데이터 전국무인교통단속카메라표준데이터를 tools/build_cameras.mjs 로 바꾼 파일) 중 경로 위에 있는 것
   필요한 것: geo.js (hav, nearestOnPath) */

/* 카카오 traffic_state → 화면 분류. 0·없음은 '정보 없음'. 그 밖의 값은 정보 없음으로 본다 */
const TRAFFIC = {
  4: { cls: 'free', label: '원활', color: '#2bb673' },
  3: { cls: 'slow', label: '서행', color: '#f2c31b' },
  2: { cls: 'delay', label: '지체', color: '#f08a24' },
  1: { cls: 'jam', label: '정체', color: '#d6322f' },
  6: { cls: 'closed', label: '통제', color: '#5b6560' }
};
const trafficOf = st => TRAFFIC[st] || null;

/* 교통 정보가 하나라도 있는 경로인가 */
const hasTraffic = r => !!(r && r.roads && r.roads.some(x => trafficOf(x.st)));

/* 경로를 도로별 교통 상태 구간으로: [{from, to, st}] (미터, 경로 시작 기준). 같은 상태가 이어지면 합친다 */
function trafficSegs(r) {
  const total = r.cum[r.cum.length - 1], out = [];
  (r.roads || []).forEach((x, i) => {
    const from = x.at, to = i + 1 < r.roads.length ? r.roads[i + 1].at : total, st = trafficOf(x.st) ? x.st : 0;
    if (to <= from) return;
    const last = out[out.length - 1];
    if (last && last.st === st && last.to === from) last.to = to; else out.push({ from, to, st });
  });
  return out;
}

/* 경로 m 미터 지점에서 도착까지 남은 시간(초) */
function remainSec(r, m) {
  const total = r.cum[r.cum.length - 1], dur = r.dur || (r.minutes || 0) * 60;
  m = Math.min(Math.max(m, 0), total);
  const roads = r.roads || [];
  const sum = roads.reduce((a, x) => a + (x.dur > 0 ? x.dur : 0), 0);
  if (!roads.length || !(sum > 0) || roads.some(x => !(x.dur >= 0))) return dur * (1 - m / total);     // 도로별 시간을 모르면 거리 비율
  const k = dur ? dur / sum : 1;                                                                        // 도로별 합과 전체 소요 시간이 조금 달라도 전체에 맞춘다
  let sec = 0;
  roads.forEach((x, i) => {
    const a = x.at, b = i + 1 < roads.length ? roads[i + 1].at : total, len = b - a;
    if (m >= b || len <= 0) return;
    sec += x.dur * k * (m <= a ? 1 : (b - m) / len);
  });
  return sec;
}

/* '12분' · '1시간 5분' · '1분 미만' */
function fmtDur(sec) {
  if (!(sec >= 0)) return '-';
  if (sec < 60) return '1분 미만';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60), mm = min % 60;
  return mm ? `${h}시간 ${mm}분` : `${h}시간`;
}
/* '오후 11:42' */
function fmtClock(ms) {
  try { return new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)); }
  catch { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
}

/* ---------- 단속 카메라 ---------- */

/* 점 p 에서 경로까지 가장 짧은 거리(m)와 그때의 경로상 위치(m). 꼭짓점이 40m 간격이라 가까운 두 선분 위로 내려 잰다 */
function snapToRoute(path, cum, p) {
  const n = nearestOnPath(path, cum, p), kx = Math.cos(rad(p[0]));
  let best = { dist: n.dist, along: n.along };
  for (const j of [n.idx - 1, n.idx]) {
    if (j < 0 || j + 1 >= path.length) continue;
    const a = path[j], b = path[j + 1];
    const ax = (a[1] - p[1]) * kx, ay = a[0] - p[0], bx = (b[1] - p[1]) * kx, by = b[0] - p[0];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(Math.max(-(ax * dx + ay * dy) / l2, 0), 1) : 0;
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dist = hav(q, p);
    if (dist < best.dist) best = { dist, along: cum[j] + (cum[j + 1] - cum[j]) * t };
  }
  return best;
}

/* 경로 위(radiusM 이내)에 있는 단속 카메라: [{at, cam, off}] 가까운 순서(경로 앞→뒤) */
function camsOnRoute(r, cams, radiusM = 35) {
  if (!Array.isArray(cams) || !cams.length) return [];
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
  r.path.forEach(([la, lo]) => { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); });
  const pad = 0.001, out = [];                                                                        // 약 100m 여유를 둔 상자 안의 카메라만 자세히 잰다
  for (const c of cams) {
    if (!(c.lat >= la0 - pad && c.lat <= la1 + pad && c.lng >= lo0 - pad && c.lng <= lo1 + pad)) continue;
    const s = snapToRoute(r.path, r.cum, [c.lat, c.lng]);
    if (s.dist <= radiusM) out.push({ at: s.along, cam: c, off: Math.round(s.dist) });
  }
  return out.sort((a, b) => a.at - b.at);
}

/* 지금 위치(pos m) 앞쪽 maxM 이내에서 가장 가까운 카메라 (이미 지난 것은 제외) */
function nextCam(list, pos, maxM) {
  const x = (list || []).find(c => c.at > pos - 10);
  return x && x.at - pos <= maxM ? x : null;
}

/* 현재 속도와 제한속도 : 'ok' | 'near'(제한 이하 10km/h 안) | 'over' | 'none' */
function speedLevel(kmh, limit) {
  if (!(limit > 0) || typeof kmh !== 'number' || !(kmh >= 0)) return 'none';
  return kmh > limit ? 'over' : kmh > limit - 10 ? 'near' : 'ok';
}
