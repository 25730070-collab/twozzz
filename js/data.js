/* data.js — 데이터셋 불러오기 : JSON(J) + API(A) + 사용자 제보(U), 상태 기록, 데이터 점검 */
let _hazards = null;
const DATA_STATUS = { static: 'wait', api: 'wait', user: 0 };   // static/api : ok | empty | fail

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
    } catch (e) { DATA_STATUS[src] = 'fail'; console.warn('[데이터 불러오기 실패]', f, e.message); }   // file:// 에서는 fetch가 막혀 실패할 수 있음
  }
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
