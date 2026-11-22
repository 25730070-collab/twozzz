/* data.js — 데이터셋 불러오기 : JSON(J) + API(A) + 사용자 제보(U), 상태 기록, 데이터 점검 */
let _hazards = null;
const DATA_STATUS = { static: 'wait', api: 'wait', user: 0, pnt: 'wait', pntMatched: 0 };   // static/api : ok | empty | fail

function fromFallback(prefix, src) {
  return new Promise(res => {
    if (window.SD_FALLBACK) return res(window.SD_FALLBACK[src] || null);
    const sc = document.createElement('script');
    sc.src = prefix + 'segments.fallback.js';
    sc.onload = () => res(window.SD_FALLBACK ? window.SD_FALLBACK[src] || null : null);
    sc.onerror = () => res(null);
    document.head.appendChild(sc);
  });
}

/* 국토교통부 사고다발지점 + 지점별 개별 사고 요약 (tools/fetch_pntfr.mjs 가 만든 data/pntfr_points.json) */
async function loadPnt(prefix) {
  try { const r = await fetch(prefix + 'pntfr_points.json'); if (!r.ok) throw new Error('HTTP ' + r.status); const l = await r.json(); return Array.isArray(l) && l.length ? l : null; }
  catch (e) { console.info('[사고 상세] pntfr_points.json 을 불러오지 못했어요 —', e.message); return null; }
}
function pntDist(a, b) {                                   // 두 점 사이 거리(m)
  const R = 6371000, r = x => x * Math.PI / 180, dl = r(b[0] - a[0]), dg = r(b[1] - a[1]);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dg / 2) ** 2));
}
function nearestPnt(seg, pts, maxM = 150) {
  if (seg.source === 'user' || isNil(seg.lat) || isNil(seg.lng)) return null;
  let best = null, bd = maxM;
  for (const p of pts) { if (!p.detail || isNil(p.lat)) continue; const dd = pntDist([seg.lat, seg.lng], [p.lat, p.lng]); if (dd <= bd) { bd = dd; best = p; } }
  return best ? { ...best, distM: Math.round(bd) } : null;
}
const PNT_SUM = [['death', '사망'], ['serious', '중상'], ['minor', '경상'], ['injured', '부상신고']];
/* 목록용 한 줄 요약: 가장 많은 사고 유형 + 사망·중상 */
function pntBrief(s) {
  const p = s && s.pnt; if (!p || !p.detail) return '';
  const top = Object.entries(p.detail.types || {}).sort((a, b) => b[1] - a[1])[0];
  const parts = [];
  if (top) parts.push(top[0].split(' · ').pop());
  if (p.detail.death) parts.push(`사망 ${p.detail.death}`);
  if (p.detail.serious) parts.push(`중상 ${p.detail.serious}`);
  return parts.join(' · ');
}

/* 가장 많은 사고 유형에 맞춘 한 줄 주의 안내.
   유형 이름(국토교통부 분류)에 들어 있는 낱말로만 찾고, 맞는 게 없으면 빈 문자열을 돌려 준다.
   유형은 데이터 값이고, 안내 문구는 일반적인 안전 운전 수칙이다 */
const TYPE_ADVICE = [
  [/횡단|보도|사람/, '보행자를 주의하세요'],
  [/후미|추돌/, '앞차와 간격을 넓히세요'],
  [/측면|직각|교차/, '교차로에서 좌우를 살피세요'],
  [/정면/, '마주 오는 차량에 주의하세요'],
  [/전도|전복|단독|이탈|공작물/, '속도를 줄이세요']
];
function pntAdvice(s) {
  const p = s && s.pnt; if (!p || !p.detail) return '';
  const top = Object.entries(p.detail.types || {}).sort((a, b) => b[1] - a[1])[0];
  if (!top) return '';
  const hit = TYPE_ADVICE.find(([re]) => re.test(top[0]));
  return hit ? hit[1] : '';
}

async function loadHazards() {
  if (_hazards) return _hazards;
  const prefix = document.body.dataset.page === 'home' ? 'data/' : '../data/';
  const rows = [];
  for (const [src, f] of [['static', 'segments_static.json'], ['api', 'segments_api.json']]) {
    try {
      const r = await fetch(prefix + f);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = await r.json();
      DATA_STATUS[src] = list.length ? 'ok' : 'empty';
      rows.push(...list);
    } catch (e) {
      // 파일을 더블클릭(file://)으로 열면 브라우저가 fetch를 막는다 → 같은 내용의 복사본(segments.fallback.js)으로 대신한다
      const list = location.protocol === 'file:' ? await fromFallback(prefix, src) : null;
      if (list) { DATA_STATUS[src] = list.length ? 'ok' : 'empty'; rows.push(...list); console.info('[데이터] file:// 에서 열어 복사본을 사용했습니다 —', f); }
      else { DATA_STATUS[src] = 'fail'; console.warn('[데이터 불러오기 실패]', f, e.message); }
    }
  }
  /* 국토교통부 사고다발지점(사고 유형·인명 피해): 구간 좌표에서 150m 안의 가장 가까운 지점을 붙인다 (파일이 없으면 붙이지 않는다) */
  const pts = await loadPnt(prefix);
  DATA_STATUS.pnt = pts ? 'ok' : 'fail'; DATA_STATUS.pntMatched = 0;
  if (pts) rows.forEach(r => { const m = nearestPnt(r, pts); if (m) { r.pnt = m; DATA_STATUS.pntMatched++; } });
  const mine = typeof getReports === 'function' ? getReports() : [];
  DATA_STATUS.user = mine.length;
  rows.push(...mine);
  _hazards = rows;                      // 더미 대체 없음: 못 불러오면 빈 배열 → 화면에서 불러오기 실패 안내
  checkData(_hazards);
  return _hazards;
}

/* 데이터 점검 : F12 Console 의 [데이터 점검] 그룹에서 확인 (건수 · 출처 · 중복 · 자료형 · null) */
function checkData(rows) {
  const warn = [], ids = new Set(), by = { static: 0, api: 0, user: 0 }, nulls = {};
  rows.forEach((r, i) => {
    by[r.source] = (by[r.source] || 0) + 1;
    if (ids.has(r.segmentId)) warn.push(`segmentId 중복: ${r.segmentId}`); ids.add(r.segmentId);
    if (!r.meta) warn.push(`[${i}] ${r.segmentId} meta(출처 플래그) 없음`);
    else if ((r.meta.dummy || []).length) warn.push(`[${i}] ${r.segmentId} 더미 필드 있음: ${r.meta.dummy}`);
    if (!['static', 'api', 'user'].includes(r.source)) warn.push(`[${i}] source 값 이상: ${r.source}`);
    if (![1, 2, 3, 4].includes(r.riskLevel)) warn.push(`[${i}] ${r.segmentId} riskLevel 이상: ${r.riskLevel}`);
    ['roadName', 'address', 'accidentCount', 'lat', 'lng', 'year'].forEach(k => { if (r.source === 'user' && ['lat', 'lng', 'year'].includes(k)) return;   // 제보는 좌표·연도를 받지 않음
      if (r[k] === null || r[k] === undefined || r[k] === '') nulls[k] = (nulls[k] || 0) + 1; });
  });
  console.groupCollapsed(`[데이터 점검] 총 ${rows.length}건 · J ${by.static} / A ${by.api} / U ${by.user}${warn.length ? ' · 경고 ' + warn.length : ''}`);
  console.log('출처 건수', by, '| 상태', { ...DATA_STATUS });
  console.log('빈 값(null) 건수', nulls);
  warn.forEach(w => console.warn(w));
  console.groupEnd();
  window.LAST_CHECK = { total: rows.length, by, nulls, warn, at: nowText() };
  return warn;
}

/* 구간 id로 구간 찾기 : 샘플 → 전체 데이터셋 순 */
async function findSegment(id) {
  return (await loadHazards()).find(s => s.segmentId === id) || null;
}
