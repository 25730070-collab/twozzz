/* route-api.js — 경로 만들기 (실제 길찾기 API 값만 사용. 키가 없으면 경로를 만들지 않는다)
   빠른 경로 = 길찾기 API 후보 중 소요 시간이 가장 짧은 경로
   안전 경로 = 시간 제한(빠른 경로의 SAFE_TIME_LIMIT배) 안에서, 경로 주변 사고 다발지점의 '사고 건수 합'이 가장 적은 경로
   후보 = ① 길찾기 API의 기본 경로들(빠른 길 · 추천 · 최단거리)
          ② 빠른 경로가 지나는 사고 다발지점 옆(양쪽)에 경유지를 두고 다시 부른 우회 경로 (모두 실제 길찾기 결과)
   더 안전한 후보가 없으면 같은 경로를 그대로 보여 주고, 그 사실을 솔직하게 알린다
   반환: { type, minutes, km, path:[[lat,lng]], guides:[{at,lat,lng,text}], hazards:[{seg, at}], score(사고 건수 합), cum } */
const LIVE = () => !!CONFIG.KAKAO_REST_KEY;

/* 브라우저는 CORS에 막힐 수 있어, 앱(Capacitor)에서는 네이티브 HTTP를 쓴다 */
const httpErr = status => { const e = new Error('HTTP ' + status); e.status = status; return e; };
async function http(method, url, { headers = {}, body } = {}) {
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  if (cap) { const r = await cap.request({ url, method, headers, data: body }); if (r.status >= 400) throw httpErr(r.status); return r.data; }
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw httpErr(r.status);
  return r.json();
}
/* 오류를 사람이 읽을 수 있는 문장으로 (원인을 단정하지 않고 확인할 곳을 알려 준다) */
function apiMessage(e) {
  const st = e && e.status;
  if (st === 401 || st === 403) return '카카오에서 요청을 받아 주지 않았어요. 키가 맞는지, 카카오 개발자 콘솔에서 지도·내비 서비스 사용 설정과 허용 주소가 맞는지 확인해 주세요';
  if (st === 429) return '길찾기 호출 한도를 넘었어요. 잠시 뒤에 다시 시도해 주세요';
  if (st >= 500) return '카카오 길찾기 서버가 응답하지 않아요. 잠시 뒤에 다시 시도해 주세요';
  if (e instanceof TypeError) return '네트워크에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요';
  return e && e.message ? e.message : '알 수 없는 오류가 났어요';
}
const auth = () => ({ Authorization: `KakaoAK ${CONFIG.KAKAO_REST_KEY}` });

/* ---------- 장소 → 좌표 ---------- */
/* 자동완성에서 고른 장소는 좌표를 이 기기에 기억해 둔다 (같은 이름을 다시 검색해서 다른 곳이 잡히는 일을 막는다) */
function rememberPlace(name, ll) {
  const m = store.get(KEY.places, {}); delete m[name]; m[name] = ll;
  const keys = Object.keys(m); if (keys.length > 60) delete m[keys[0]];
  store.set(KEY.places, m);
}
const recalledPlace = name => { const m = store.get(KEY.places, {}), v = m && m[name]; return Array.isArray(v) && v.length === 2 ? v : null; };

/* 자동완성 후보 (키가 없으면 빈 목록) */
async function searchPlaces(q, size = 6) {
  if (!LIVE()) return [];
  const j = await http('GET', `${CONFIG.LOCAL_SEARCH_URL}?query=${encodeURIComponent(q)}&size=${size}`, { headers: auth() });
  return (j.documents || []).map(d => ({ name: d.place_name, addr: d.road_address_name || d.address_name || '', ll: [Number(d.y), Number(d.x)] }));
}

async function resolvePlace(name) {
  const known = name !== '내 위치' && recalledPlace(name);
  if (known) return { name, ll: known };
  if (name === '내 위치') {
    return new Promise((ok, no) => navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(p => ok({ name, ll: [p.coords.latitude, p.coords.longitude] }), () => no(new Error('위치 권한이 없어 내 위치를 쓸 수 없어요')), { enableHighAccuracy: true, timeout: 8000 })
      : no(new Error('이 기기에서는 내 위치를 쓸 수 없어요')));
  }
  let j;
  try { j = await http('GET', `${CONFIG.LOCAL_SEARCH_URL}?query=${encodeURIComponent(name)}&size=1`, { headers: auth() }); }
  catch (e) { throw new Error(apiMessage(e)); }
  const d = j.documents && j.documents[0];
  if (!d) throw new Error('장소를 찾지 못했어요: ' + name);
  return { name: d.place_name, ll: [Number(d.y), Number(d.x)] };
}

/* ---------- 경로 마무리: 누적거리 · 지나는 사고 다발지점 · 회전 안내 위치 ---------- */
function finalize(r, hz) {
  /* 도로별 정보(카카오 roads): 받은 좌표 그대로의 누적거리로 '경로 어디서부터 시작하는 도로인지' 잰다.
     교통 막대와 남은 시간 계산에 쓴다. roads 가 없으면(옛 캐시·다른 응답) 빈 배열 */
  const raw = cumulative(r.path);
  r.roads = (r.roads || []).filter(x => x.i < raw.length).map(x => ({ at: Math.round(raw[x.i]), dur: x.dur, st: x.st, spd: x.spd }));
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
  const path = [], guides = [], roads = [];
  (route.sections || []).forEach(sec => {
    (sec.roads || []).forEach(rd => {
      const num = x => (typeof x === 'number' && isFinite(x) ? x : undefined);
      roads.push({ i: path.length, dur: num(rd.duration), st: num(rd.traffic_state), spd: num(rd.traffic_speed) });   // 이 도로가 path 의 몇 번째 좌표에서 시작하는지
      const v = rd.vertexes || []; for (let i = 0; i + 1 < v.length; i += 2) path.push([v[i + 1], v[i]]);
    });
    (sec.guides || []).forEach(g => { const text = g.guidance || g.name || ''; if (/경유지/.test(text)) return; guides.push({ lat: g.y, lng: g.x, text }); });   // 우회용 경유지는 사용자가 정한 곳이 아니라서 안내에서 뺀다
  });
  const sum = route.summary || {};
  return { path, guides, roads, duration: sum.duration, distance: sum.distance };
}

/* 한 번의 길찾기 호출 → 후보 경로들. 실패하면 null (호출한 쪽에서 마지막 오류를 기억한다) */
async function kakaoCall(o, d, { priority, via = [], alternatives = false }, onErr) {
  try {
    let qsx = `origin=${o[1]},${o[0]}&destination=${d[1]},${d[0]}&priority=${priority}&summary=false`;
    if (alternatives) qsx += '&alternatives=true';
    if (via.length) qsx += '&waypoints=' + via.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join('|');
    const j = await http('GET', `${CONFIG.DIRECTIONS_URL}?${qsx}`, { headers: auth() });
    const out = [];
    (j.routes || []).forEach(r => { if (!r.result_code || r.result_code === 0) { const c = parseKakao(r); if (c.path.length > 1 && c.duration) out.push(c); } });
    return out;
  } catch (e) { console.warn('길찾기 호출 실패:', priority, via.length ? '(경유지)' : '', e.message); if (onErr) onErr(e); return []; }
}

/* 같은 경로(소요 시간·거리가 같은 것) 중복 제거 */
function uniqueRoutes(list) {
  const seen = new Set();
  return list.filter(c => { const k = `${c.duration}|${c.distance}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* 동시에 n개씩만 호출 (짧은 시간에 몰려 거절되는 것을 막는다) */
async function pool(tasks, n = 3) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

/* 우회 경유지: 사고가 많은 다발지점마다, 그 지점에서 경로의 양쪽 옆으로 떨어진 점 */
function detourWaypoints(route, tried, maxHazards) {
  const total = route.cum[route.cum.length - 1];
  const off = Math.min(Math.max(total * 0.06, 450), 1200);            // 경로 길이의 6% (450m ~ 1.2km)
  const pts = [];
  [...route.hazards].sort((a, b) => b.seg.accidentCount - a.seg.accidentCount)
    .filter(h => h.at > 300 && h.at < total - 300)                    // 출발·도착 바로 앞은 피할 수 없다
    .slice(0, maxHazards).forEach(h => {
      const base = pointAt(route.path, route.cum, h.at).pos;
      const brg = bearing(pointAt(route.path, route.cum, h.at - 150).pos, pointAt(route.path, route.cum, h.at + 150).pos);
      [-90, 90].forEach(turn => {
        const p = destPoint(base, (brg + turn + 360) % 360, off);
        if (![...tried, ...pts].some(q => hav(q, p) < 300)) pts.push(p);   // 이미 시도한 곳 근처는 건너뜀
      });
    });
  return pts;
}

async function liveRoutes(oName, dName, onStage, opts = {}) {
  if (!LIVE()) throw new Error('경로 서비스에 아직 연결되지 않았어요');
  const say = m => { try { onStage && onStage(m); } catch {} };
  say('출발지와 도착지 위치를 찾는 중…');
  const [o, d] = [await resolvePlace(oName), await resolvePlace(dName)];
  let lastErr = null; const onErr = e => { lastErr = e; };
  const hz = await loadHazards();
  const toRoute = c => { const r = finalize({ path: c.path, guides: c.guides, roads: c.roads }, hz); r.minutes = Math.round(c.duration / 60); r.dur = c.duration; r.dist = c.distance; r.via = !!c.via; return r; };

  /* ① 기본 경로 : 빠른 길 · 추천 · 최단거리를 한꺼번에 */
  say('길찾기 경로를 받아 오는 중…');
  const base = (await Promise.all([
    kakaoCall(o.ll, d.ll, { priority: 'TIME', alternatives: true }, onErr),
    kakaoCall(o.ll, d.ll, { priority: 'RECOMMEND', alternatives: true }, onErr),
    kakaoCall(o.ll, d.ll, { priority: 'DISTANCE', alternatives: true }, onErr)])).flat();
  const cands = uniqueRoutes(base);
  if (!cands.length) throw new Error(lastErr ? apiMessage(lastErr) : '이 출발지와 도착지 사이의 경로를 받지 못했어요');
  let routes = cands.map(toRoute);
  const fast = [...routes].sort((a, b) => a.minutes - b.minutes)[0];
  const limit = fast.minutes * CONFIG.SAFE_TIME_LIMIT;
  const baseCount = routes.length;

  /* ② 우회 경로 : 가장 위험한 다발지점 옆에 경유지를 두고 다시 길찾기 (최대 2라운드, 호출 수 제한) */
  let budget = opts.detours === false ? 0 : CONFIG.DETOUR_CALLS, tried = [];   // 재탐색(opts.detours=false)에서는 우회 탐색을 건너뛰어 빠르게
  const bestSoFar = () => [...routes].filter(r => r.minutes <= limit).sort((a, b) => a.score - b.score || a.minutes - b.minutes)[0];
  for (let round = 0; round < 2 && budget > 0; round++) {
    const from = round === 0 ? fast : bestSoFar();                      // 2라운드: 지금까지 가장 안전한 경로의 남은 지점을 다시 피해 본다
    if (!from || !from.hazards.length || (round > 0 && from === fast)) break;
    const pts = detourWaypoints(from, tried, round === 0 ? 3 : 2).slice(0, budget);
    if (!pts.length) break;
    tried = tried.concat(pts); budget -= pts.length;
    say(round === 0 ? '사고 다발지점을 피하는 우회 경로를 찾는 중…' : '더 안전한 길이 있는지 한 번 더 찾는 중…');
    const got = (await pool(pts.map(p => () => kakaoCall(o.ll, d.ll, { priority: 'RECOMMEND', via: [p] }, onErr)))).flat();
    const have = new Set(routes.map(r => `${r.dur}|${r.dist}`));          // 이미 있는 경로와 같으면 버린다
    uniqueRoutes(got).forEach(c => { if (!have.has(`${c.duration}|${c.distance}`)) routes.push(toRoute({ ...c, via: true })); });
  }

  say('가장 안전한 경로를 고르는 중…');
  const ok = routes.filter(r => r.minutes <= limit);
  const better = ok.filter(r => r.score < fast.score).sort((a, b) => a.score - b.score || a.minutes - b.minutes);
  const safe = better[0] || fast;
  return {
    fast: { ...fast, type: 'fast' }, safe: { ...safe, type: 'safe' },
    same: !better.length,
    count: routes.length, baseCount, detourCount: routes.length - baseCount,
    /* 비교한 후보 전부 (화면의 '비교한 후보 경로 보기'용) */
    candidates: routes.map(r => ({ minutes: r.minutes, km: r.km, hazards: r.hazards.length, score: r.score, via: r.via, over: r.minutes > limit, isFast: r === fast, isSafe: r === safe })).sort((a, b) => a.minutes - b.minutes || a.score - b.score),
    limitMinutes: Math.floor(limit * 10) / 10,
    /* 출발지·도착지 300m 안의 다발지점은 어떤 길로 가도 가까이 지나게 되어 피하기 어렵다 */
    fixed: (() => { const total = fast.cum[fast.cum.length - 1], f = fast.hazards.filter(h => h.at <= 300 || h.at >= total - 300); return { n: f.length, score: f.reduce((a, h) => a + h.seg.accidentCount, 0) }; })(),
    origin: o.name, destination: d.name
  };
}

/* ---------- 진입점: 같은 출발·도착은 10분간 세션에 캐시 (API 호출 절약) ---------- */
async function buildRoutes(oName, dName, onStage) {
  const key = `sd_rt6|${oName}|${dName}`;
  try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 600000) return c.v; } catch {}
  const v = await liveRoutes(oName, dName, onStage);
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
  return v;
}
