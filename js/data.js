/* data.js — 기본 데이터셋(JSON) 불러오기. 실패하면 mock.js 샘플로 대체 */
let _hazards = null;

async function loadHazards() {
  if (_hazards) return _hazards;
  const prefix = document.body.dataset.page === 'home' ? 'data/' : '../data/';
  const rows = [];
  for (const f of ['segments_static.json', 'segments_api.json']) {
    try { const r = await fetch(prefix + f); if (r.ok) rows.push(...await r.json()); } catch {}   // file:// 에서는 fetch가 막혀 실패할 수 있음
  }
  _hazards = rows.length ? rows : SEGMENTS;
  return _hazards;
}

/* 구간 id로 구간 찾기 : 샘플 → 전체 데이터셋 순 */
async function findSegment(id) {
  return SEGMENTS.find(s => s.segmentId === id) || (await loadHazards()).find(s => s.segmentId === id) || null;
}
