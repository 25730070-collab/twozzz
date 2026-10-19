/* route-api.js — 경로 만들기 : 키가 있으면 카카오 API(라이브), 없으면 샘플(데모)
   반환 경로 형태: { type, minutes, km, path:[[lat,lng]], guides:[{at,lat,lng,text}],
                    hazards:[{seg, at}], score, high, cum }  (at 단위: m) */

const PLACES = {
  '강남역': [37.4979, 127.0276], '잠실역': [37.5133, 127.1001], '역삼동': [37.5007, 127.0365],
  '선릉역': [37.5045, 127.0490], '잠실대로': [37.5113, 127.0980], '송파구청': [37.5145, 127.1059],
  '신촌역': [37.5551, 126.9368], '홍대입구역': [37.5572, 126.9245], '서울역': [37.5547, 126.9707],
  '여의도역': [37.5215, 126.9243]
};
const LIVE = () => !!CONFIG.KAKAO_REST_KEY;

/* 브라우저는 CORS에 막힐 수 있어, 앱(Capacitor)에서는 네이티브 HTTP를 쓴다 */
async function http(method, url, { headers = {}, body } = {}) {
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (cap) { const r = await cap.request({ url, method, headers, data: body }); return r.data; }
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ---------- 장소 → 좌표 ---------- */
async function resolvePlace(name) {
  if (name === '내 위치') {
    if (LIVE()) return new Promise((ok, no) => navigator.geolocation.getCurrentPosition(
      p => ok({ name, ll: [p.coords.latitude, p.coords.longitude] }), no, { enableHighAccuracy: true, timeout: 8000 }));
    return { name: '강남역(데모 위치)', ll: PLACES['강남역'] };
  }
  if (LIVE()) {
    const j = await http('GET', `${CONFIG.LOCAL_SEARCH_URL}?query=${encodeURIComponent(name)}&size=1`,
      { headers: { Authorization: `KakaoAK ${CONFIG.KAKAO_REST_KEY}` } });
    const d = j.documents && j.documents[0];
    if (!d) throw new Error('장소를 찾지 못했어요: ' + name);
    return { name: d.place_name, ll: [Number(d.y), Number(d.x)] };
  }
  const key = Object.keys(PLACES).find(k => k === name || name.includes(k) || k.includes(name));
  return key ? { name: key, ll: PLACES[key] } : null;
}

/* ---------- 경로 마무리: 누적거리 · 위험 구간 · 회전 안내 위치 계산 ---------- */
function finalize(r) {
  r.path = densify(r.path, 40);
  r.cum = cumulative(r.path);
  r.km = +(r.cum[r.cum.length - 1] / 1000).toFixed(1);
  r.guides.forEach(g => { g.at = nearestOnPath(r.path, r.cum, [g.lat, g.lng]).along; });
  r.guides.sort((a, b) => a.at - b.at);
  r.hazards = r.hazards.map(h => ({ seg: h.seg, at: nearestOnPath(r.path, r.cum, [h.seg.lat, h.seg.lng]).along }))
                       .sort((a, b) => a.at - b.at);
  r.score = r.hazards.reduce((a, h) => a + WEIGHT[h.seg.riskLevel], 0);
  r.high = r.hazards.filter(h => h.seg.riskLevel >= 3).length;
  return r;
}

/* ---------- 데모: 샘플 구간 좌표를 지나는 경로를 만든다 ---------- */
function demoRoutes(oName, dName) {
  const { route, matched } = resolveRoute(oName, dName);
  const o = PLACES[oName] || PLACES[route.origin], d = PLACES[dName] || PLACES[route.destination];
  const dy = d[0] - o[0], dx = d[1] - o[1], len2 = dx * dx + dy * dy || 1;
  const t = p => ((p[1] - o[1]) * dx + (p[0] - o[0]) * dy) / len2;
  const norm = Math.hypot(dx, dy) || 1, px = -dy / norm, py = dx / norm;       // 진행 방향의 수직 벡터

  const build = type => {
    const keep = new Set(type === 'safe' ? safeSegmentIds(route) : route.segmentIds);
    const pts = [], hazards = [];
    route.segmentIds.forEach((id, i) => {
      const s = segById(id), p = [s.lat, s.lng];
      if (keep.has(id)) { pts.push({ p, t: t(p) }); hazards.push({ seg: s }); }
      else { const sign = i % 2 ? 1 : -1, q = [p[0] + py * 0.0065 * sign, p[1] + px * 0.0065 * sign]; pts.push({ p: q, t: t(p) }); }   // 위험 구간을 비켜 가는 우회점
    });
    pts.sort((a, b) => a.t - b.t);
    const wp = [o, ...pts.map(x => x.p), d];
    const guides = [{ lat: o[0], lng: o[1], text: '출발합니다' }];
    for (let i = 1; i < wp.length - 1; i++) {
      const turn = ((bearing(wp[i], wp[i + 1]) - bearing(wp[i - 1], wp[i]) + 540) % 360) - 180;
      if (Math.abs(turn) > 28) guides.push({ lat: wp[i][0], lng: wp[i][1], text: turn > 0 ? '우회전' : '좌회전' });
    }
    guides.push({ lat: d[0], lng: d[1], text: '목적지에 도착합니다' });
    const r = finalize({ type, path: wp, guides, hazards });
    r.minutes = Math.max(5, Math.round(r.km / 32 * 60));
    return r;
  };
  return { fast: build('fast'), safe: build('safe'), matched, mode: 'demo' };
}

/* ---------- 라이브: 카카오 길찾기 API ---------- */
function parseKakao(route) {
  const path = [], guides = [];
  (route.sections || []).forEach(sec => {
    (sec.roads || []).forEach(rd => { const v = rd.vertexes || []; for (let i = 0; i + 1 < v.length; i += 2) path.push([v[i + 1], v[i]]); });
    (sec.guides || []).forEach(g => guides.push({ lat: g.y, lng: g.x, text: g.guidance || g.name || '' }));
  });
  const sum = route.summary || {};
  return { path, guides, duration: sum.duration, distance: sum.distance };
}

async function kakaoCandidates(o, d) {
  const out = [];
  for (const priority of ['TIME', 'RECOMMEND', 'DISTANCE']) {
    try {
      const j = await http('POST', CONFIG.DIRECTIONS_URL, {
        headers: { Authorization: `KakaoAK ${CONFIG.KAKAO_REST_KEY}`, 'Content-Type': 'application/json' },
        body: { origin: { x: o[1], y: o[0] }, destination: { x: d[1], y: d[0] }, priority, alternatives: true, summary: false }
      });
      (j.routes || []).forEach(r => { if (!r.result_code || r.result_code === 0) { const c = parseKakao(r); if (c.path.length > 1) out.push(c); } });
    } catch (e) { console.warn('길찾기 호출 실패:', priority, e.message); }
  }
  const seen = new Set();                                            // 거의 같은 경로 중복 제거
  return out.filter(c => { const k = `${c.duration}|${c.distance}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function liveRoutes(oName, dName) {
  const [o, d] = [await resolvePlace(oName), await resolvePlace(dName)];
  const cands = await kakaoCandidates(o.ll, d.ll);
  if (!cands.length) throw new Error('경로를 받지 못했어요');
  const hz = await loadHazards();
  const routes = cands.map(c => {
    const r = finalize({ type: 'fast', path: c.path, guides: c.guides, hazards: [] });
    const near = hz.filter(s => s.lat && nearestOnPath(r.path, r.cum, [s.lat, s.lng]).dist <= CONFIG.HAZARD_RADIUS_M);
    r.hazards = near.map(s => ({ seg: s })); finalize(r);
    r.minutes = Math.round((c.duration || r.km / 30 * 3600) / 60);
    return r;
  });
  const fast = [...routes].sort((a, b) => a.minutes - b.minutes)[0];
  const ok = routes.filter(r => r.minutes <= fast.minutes * CONFIG.SAFE_TIME_LIMIT);
  const safe = [...ok].sort((a, b) => a.score - b.score || a.minutes - b.minutes)[0];
  return { fast: { ...fast, type: 'fast' }, safe: { ...safe, type: 'safe' }, matched: true, mode: 'live', origin: o.name, destination: d.name };
}

/* ---------- 진입점: 같은 출발·도착은 10분간 세션에 캐시 (API 호출 절약) ---------- */
async function buildRoutes(oName, dName) {
  const key = `sd_rt|${LIVE() ? 'live' : 'demo'}|${oName}|${dName}`;
  try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 600000) return c.v; } catch {}
  let v;
  if (LIVE()) { try { v = await liveRoutes(oName, dName); } catch (e) { console.warn(e); v = { ...demoRoutes(oName, dName), error: e.message }; } }
  else v = demoRoutes(oName, dName);
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
  return v;
}
