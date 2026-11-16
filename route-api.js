/* route-api.js — 경로 만들기 (실제 길찾기 API 값만 사용. 키가 없으면 경로를 만들지 않는다)
   빠른 경로 = 길찾기 API 후보 중 소요 시간이 가장 짧은 경로
   안전 경로 = 시간 제한(빠른 경로의 SAFE_TIME_LIMIT배) 안에서, 경로 주변 사고 다발지점의 '사고 건수 합'이 가장 적은 경로
   반환: { type, minutes, km, path:[[lat,lng]], guides:[{at,lat,lng,text}], hazards:[{seg, at}], score(사고 건수 합), cum } */
const LIVE = () => !!CONFIG.KAKAO_REST_KEY;

/* 브라우저는 CORS에 막힐 수 있어, 앱(Capacitor)에서는 네이티브 HTTP를 쓴다 */
async function http(method, url, { headers = {}, body } = {}) {
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (cap) { const r = await cap.request({ url, method, headers, data: body }); return r.data; }
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const auth = () => ({ Authorization: `KakaoAK ${CONFIG.KAKAO_REST_KEY}` });

/* ---------- 장소 → 좌표 ---------- */
async function resolvePlace(name) {
  if (name === '내 위치') {
    return new Promise((ok, no) => navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(p => ok({ name, ll: [p.coords.latitude, p.coords.longitude] }), () => no(new Error('위치 권한이 없어 내 위치를 쓸 수 없어요')), { enableHighAccuracy: true, timeout: 8000 })
      : no(new Error('이 기기에서는 내 위치를 쓸 수 없어요')));
  }
  const j = await http('GET', `${CONFIG.LOCAL_SEARCH_URL}?query=${encodeURIComponent(name)}&size=1`, { headers: auth() });
  const d = j.documents && j.documents[0];
  if (!d) throw new Error('장소를 찾지 못했어요: ' + name);
  return { name: d.place_name, ll: [Number(d.y), Number(d.x)] };
}

/* ---------- 경로 마무리: 누적거리 · 지나는 사고 다발지점 · 회전 안내 위치 ---------- */
function finalize(r, hz) {
  r.path = densify(r.path, 40);
  r.cum = cumulative(r.path);
  r.km = +(r.cum[r.cum.length - 1] / 1000).toFixed(1);
  r.guides.forEach(g => { g.at = nearestOnPath(r.path, r.cum, [g.lat, g.lng]).along; });
  r.guides.sort((a, b) => a.at - b.at);
  r.hazards = hz.filter(s => !isNil(s.lat) && !isNil(s.lng) && !isNil(s.accidentCount))
    .map(s => ({ seg: s, n: nearestOnPath(r.path, r.cum, [+s.lat, +s.lng]) }))
    .filter(x => x.n.dist <= CONFIG.HAZARD_RADIUS_M)
    .map(x => ({ seg: x.seg, at: x.n.along })).sort((a, b) => a.at - b.at);
  r.score = r.hazards.reduce((a, h) => a + h.seg.accidentCount, 0);
  return r;
}

/* ---------- 카카오 길찾기 API ---------- */
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
      const qsx = `origin=${o[1]},${o[0]}&destination=${d[1]},${d[0]}&priority=${priority}&alternatives=true&summary=false`;
      const j = await http('GET', `${CONFIG.DIRECTIONS_URL}?${qsx}`, { headers: auth() });
      (j.routes || []).forEach(r => { if (!r.result_code || r.result_code === 0) { const c = parseKakao(r); if (c.path.length > 1 && c.duration) out.push(c); } });
    } catch (e) { console.warn('길찾기 호출 실패:', priority, e.message); }
  }
  const seen = new Set();                                            // 같은 경로 중복 제거
  return out.filter(c => { const k = `${c.duration}|${c.distance}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function liveRoutes(oName, dName) {
  if (!LIVE()) throw new Error('경로 서비스에 아직 연결되지 않았어요');
  const [o, d] = [await resolvePlace(oName), await resolvePlace(dName)];
  const cands = await kakaoCandidates(o.ll, d.ll);
  if (!cands.length) throw new Error('이 출발지와 도착지 사이의 경로를 받지 못했어요');
  const hz = await loadHazards();
  const routes = cands.map(c => { const r = finalize({ path: c.path, guides: c.guides }, hz); r.minutes = Math.round(c.duration / 60); return r; });
  const fast = [...routes].sort((a, b) => a.minutes - b.minutes)[0];
  const ok = routes.filter(r => r.minutes <= fast.minutes * CONFIG.SAFE_TIME_LIMIT);
  const safe = [...ok].sort((a, b) => a.score - b.score || a.minutes - b.minutes)[0];
  return { fast: { ...fast, type: 'fast' }, safe: { ...safe, type: 'safe' }, same: safe === fast || safe.score >= fast.score, count: routes.length, origin: o.name, destination: d.name };
}

/* ---------- 진입점: 같은 출발·도착은 10분간 세션에 캐시 (API 호출 절약) ---------- */
async function buildRoutes(oName, dName) {
  const key = `sd_rt3|${oName}|${dName}`;
  try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 600000) return c.v; } catch {}
  const v = await liveRoutes(oName, dName);
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
  return v;
}
