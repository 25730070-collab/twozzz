/* list.js — 위험 구간: 검색 · 필터(위험등급·지역·연도·구분) · 정렬(4가지) · 더 보기 */
const PAGE = 20;
const st = { risk: new Set(), gu: new Set(), src: new Set(), year: new Set(), q: (qs().get('q') || '').trim(), sort: 'default', shown: PAGE };
let ALL = [];

function render() {
  let rows = ALL.filter(s =>
    (!st.src.size || st.src.has(s.source)) &&
    (!st.q || st.q.split(/\s+/).every(w => `${s.roadName} ${s.address}`.includes(w))) &&   // 단어를 띄어 쓰면 모두 들어 있는 구간
    (!st.year.size || st.year.has(String(s.year))) &&
    (!st.risk.size || st.risk.has(String(s.riskLevel))) &&
    (!st.gu.size || st.gu.has(guOf(s))));
  const num = v => (v === null || v === undefined ? null : v);
  const by = { count: (a, b) => (b.accidentCount ?? -1) - (a.accidentCount ?? -1), countAsc: (a, b) => (a.accidentCount ?? 1e9) - (b.accidentCount ?? 1e9), year: (a, b) => (num(b.year) ?? -1) - (num(a.year) ?? -1) || (b.accidentCount ?? -1) - (a.accidentCount ?? -1) }[st.sort];
  if (by) rows = [...rows].sort(by);

  $('#resultList').innerHTML = rows.slice(0, st.shown).map(segCard).join('');
  const hi = rows.filter(s => s.riskLevel >= 3).length;
  const c = k => rows.filter(s => s.source === k).length;
  $('#resultCount').textContent = `${rows.length}개 구간`;
  paintNote(); paintChips();
  $('#moreBtn').hidden = rows.length <= st.shown;
  $('#moreBtn').textContent = `더 보기 (${Math.min(st.shown, rows.length)}/${rows.length})`;
  $('#state-empty').classList.toggle('on', rows.length === 0);
  if (rows.length === 0) $('#state-empty').innerHTML = emptyState({
    title: st.q ? `"${esc(st.q)}"에 맞는 구간이 없어요` : '조건에 맞는 구간이 없어요',
    tips: ['도로명이나 동 이름 일부만 입력해 보세요 (예: 테헤란, 논현)', '위험등급·지역·연도·데이터 필터를 해제해 보세요', '찾는 구간이 없다면 직접 제보할 수 있어요'],
    actions: [{ id: 'clearFilter', label: '조건 모두 해제' }, { href: 'report.html', label: '구간 제보하기' }] });
  $('#resultWrap').hidden = rows.length === 0;
  paintListMap(rows);
}

/* 위에 놓는 지도 : 지금 조건에 맞는 구간 전부를 위험등급 색 점으로. 점을 누르면 이름·건수·상세 링크 (지도를 못 불러오면 숨김) */
let lmP = null, lmLayer = null, lmSig = '';
async function paintListMap(rows) {
  const el = $('#listMap'), pts = rows.filter(s => !isNil(s.lat) && !isNil(s.lng));
  el.hidden = pts.length === 0; if (!pts.length) return;
  lmP = lmP || createMap(el, { center: [37.5665, 126.978], zoom: 11, lite: true, preferCanvas: true });
  const m = await lmP;
  if (!m) { el.hidden = true; return; }
  el.classList.remove('skel'); m.map.invalidateSize();
  if (lmLayer) lmLayer.remove();
  lmLayer = m.L.layerGroup().addTo(m.map);
  [...pts].sort((a, b) => a.riskLevel - b.riskLevel).forEach(s => hazardDot(m, s, { radius: 6, layer: lmLayer }));   // 위험한 점이 위에 오도록 낮은 등급부터
  const sig = [st.q, [...st.risk], [...st.gu], [...st.src], [...st.year]].join('|');
  if (sig !== lmSig) { lmSig = sig; m.map.fitBounds(m.L.latLngBounds(pts.map(s => [+s.lat, +s.lng])), { padding: [24, 24], maxZoom: 15 }); }   // 더 보기·정렬만 바뀔 땐 지도를 움직이지 않는다
}

/* 데이터 상태 안내 : API 연결 실패 · 0건일 때 표준 문구 */
function paintNote() {
  const n = $('#srcNote'), s = DATA_STATUS;
  const msg = s.api === 'fail' ? '일부 구간 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
            : s.api === 'empty' ? '일부 구간 정보가 아직 없어요.'
            : s.static === 'fail' ? '구간 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' : '';
  n.hidden = !msg; n.className = 'note' + (msg ? ' err' : ''); n.textContent = msg;
}
$('#q').addEventListener('input', e => { st.q = e.target.value.trim(); st.shown = PAGE; render(); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && st.q) { addRecent(st.q); e.target.blur(); } });   // 검색어는 Enter로 확정할 때 최근 검색에 기록

/* 필터 칩 : 선택 개수를 글자에 보여 주고, 선택돼 있으면 강조한다 */
const FILTERS = { filterRiskBtn: () => st.risk, filterGuBtn: () => st.gu, filterYearBtn: () => st.year };
const SORT_LABEL = { default: '기본순', count: '사고많은순', countAsc: '사고적은순', year: '최근연도순' };
function paintChips() {
  Object.entries(FILTERS).forEach(([id, get]) => {
    const b = $('#' + id), n = get().size, open = $('#' + b.dataset.panel).classList.contains('on');
    b.innerHTML = `${b.dataset.label}${n ? ` ${n}` : ''}${ico(open ? 'up' : 'down')}`;
    b.classList.toggle('on', n > 0); b.setAttribute('aria-expanded', String(open));
  });
  $('#sortChip').textContent = SORT_LABEL[st.sort];
  $('#sortChip').classList.toggle('on', st.sort !== 'default');
  $('#resetFilter').hidden = !(st.q || st.risk.size || st.gu.size || st.year.size || st.src.size || st.sort !== 'default');
}
const closePanels = () => $$('.fpanels .panel').forEach(x => x.classList.remove('on'));

document.addEventListener('click', e => {
  const t = e.target;
  if (!t.closest('.subbar')) closePanels();                  // 필터 영역 밖을 누르면 접기
  const btn = t.closest('#filterRiskBtn, #filterGuBtn, #filterYearBtn');
  if (btn) {
    const panel = $('#' + btn.dataset.panel), was = panel.classList.contains('on');
    closePanels(); panel.classList.toggle('on', !was); paintChips();
    return;
  }
  const opt = t.closest('.panel .opt');
  if (opt) {
    const set = opt.dataset.riskOpt ? st.risk : opt.dataset.yearOpt ? st.year : st.gu, v = opt.dataset.riskOpt || opt.dataset.yearOpt || opt.dataset.guOpt;
    set.has(v) ? set.delete(v) : set.add(v);
    opt.classList.toggle('on', set.has(v));
    st.shown = PAGE; render(); return;
  }
  if (t.closest('#sortChip')) {
    const order = ['default', 'count', 'countAsc', 'year'];
    st.sort = order[(order.indexOf(st.sort) + 1) % order.length];
    closePanels(); render(); return;
  }
  if (t.closest('#resetFilter') || t.closest('#clearFilter')) {
    st.risk.clear(); st.gu.clear(); st.src.clear(); st.year.clear(); st.q = ''; $('#q').value = ''; st.sort = 'default'; st.shown = PAGE;
    $$('.panel .opt.on').forEach(x => x.classList.remove('on'));
    closePanels(); render(); return;
  }
  if (t.id === 'moreBtn') { st.shown += PAGE; render(); return; }
  if (t.id === 'retryList') { location.reload(); return; }
});

$('#state-loading').classList.add('on'); $('#resultWrap').hidden = true;
loadHazards().then(rows => {
  ALL = rows; $('#state-loading').classList.remove('on');
  const gus = [...new Set(rows.map(guOf))].sort();
  $('#filterGuPanel').innerHTML = gus.map(g => `<button class="chip opt" data-gu-opt="${esc(g)}">${esc(g)}</button>`).join('');
  const years = [...new Set(rows.map(r => r.year).filter(y => y != null))].sort((a, b) => b - a);
  $('#filterYearPanel').innerHTML = years.map(y => `<button class="chip opt" data-year-opt="${y}">${y}년</button>`).join('');
  if (years.length <= 1) $('#filterYearBtn').hidden = true;                       // 최신 연도 하나로 통일했으니 연도 고르기는 필요 없다
  $('#q').value = st.q;
  if (!rows.length) { $('#state-error').classList.add('on'); $('#resultWrap').hidden = true; $('#resultCount').textContent = ''; return; }
  render();
});
