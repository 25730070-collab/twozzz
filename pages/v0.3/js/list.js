/* list.js — 위험 구간: 필터 · 정렬 · 더 보기 */
const PAGE = 20;
const st = { risk: new Set(), gu: new Set(), src: new Set(), q: (qs().get('q') || '').trim(), sort: 'default', shown: PAGE };
let ALL = [];

function render() {
  let rows = ALL.filter(s =>
    (!st.src.size || st.src.has(s.source)) &&
    (!st.q || `${s.roadName} ${s.address}`.includes(st.q)) &&
    (!st.risk.size || st.risk.has(String(s.riskLevel))) &&
    (!st.gu.size || st.gu.has(guOf(s))));
  if (st.sort === 'count') rows = [...rows].sort((a, b) => (b.accidentCount ?? -1) - (a.accidentCount ?? -1));

  $('#resultList').innerHTML = rows.slice(0, st.shown).map(segCard).join('');
  const hi = rows.filter(s => s.riskLevel >= 3).length;
  const c = k => rows.filter(s => s.source === k).length;
  $('#resultCount').textContent = `총 ${rows.length}개 구간`;
  paintNote();
  $('#moreBtn').hidden = rows.length <= st.shown;
  $('#moreBtn').textContent = `더 보기 (${Math.min(st.shown, rows.length)}/${rows.length})`;
  $('#state-empty').classList.toggle('on', rows.length === 0);
  if (rows.length === 0) $('#state-empty').innerHTML = emptyState({
    title: st.q ? `"${esc(st.q)}"에 맞는 구간이 없어요` : '조건에 맞는 구간이 없어요',
    tips: ['도로명이나 동 이름 일부만 입력해 보세요 (예: 테헤란, 논현)', '위험등급·지역·데이터 필터를 해제해 보세요', '찾는 구간이 없다면 직접 제보할 수 있어요'],
    actions: [{ id: 'clearFilter', label: '조건 모두 해제' }, { href: 'report.html', label: '구간 제보하기' }] });
  $('#resultWrap').hidden = rows.length === 0;
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

document.addEventListener('click', e => {
  const t = e.target;
  const btn = t.closest('#filterRiskBtn, #filterGuBtn, #filterSrcBtn');
  if (btn) {
    const panel = btn.nextElementSibling, was = panel.classList.contains('on');
    $$('.panel').forEach(x => x.classList.remove('on'));
    panel.classList.toggle('on', !was);
    return;
  }
  const opt = t.closest('.panel .opt');
  if (opt) {
    const set = opt.dataset.srcOpt ? st.src : opt.dataset.riskOpt ? st.risk : st.gu, v = opt.dataset.srcOpt || opt.dataset.riskOpt || opt.dataset.guOpt;
    set.has(v) ? set.delete(v) : set.add(v);
    opt.classList.toggle('on', set.has(v));
    st.shown = PAGE; render(); return;
  }
  if (t.id === 'sortChip') {
    st.sort = st.sort === 'count' ? 'default' : 'count';
    t.textContent = (st.sort === 'count' ? '사고많은순' : '기본순') + ' ▾';
    t.classList.toggle('on', st.sort === 'count');
    render(); return;
  }
  if (t.id === 'resetFilter' || t.id === 'clearFilter') {
    st.risk.clear(); st.gu.clear(); st.src.clear(); st.q = ''; $('#q').value = ''; st.q = ''; $('#q').value = ''; st.sort = 'default'; st.shown = PAGE;
    $$('.panel .opt.on').forEach(x => x.classList.remove('on'));
    $('#sortChip').textContent = '기본순 ▾'; $('#sortChip').classList.remove('on');
    render(); return;
  }
  if (t.id === 'moreBtn') { st.shown += PAGE; render(); return; }
  if (t.id === 'retryList') { location.reload(); return; }
  if (!t.closest('.dropdown')) $$('.panel').forEach(x => x.classList.remove('on'));
});

$('#state-loading').classList.add('on'); $('#resultWrap').hidden = true;
loadHazards().then(rows => {
  ALL = rows; $('#state-loading').classList.remove('on');
  const gus = [...new Set(rows.map(guOf))].sort();
  $('#filterGuPanel').innerHTML = gus.map(g => `<button class="chip opt" data-gu-opt="${esc(g)}">${esc(g)}</button>`).join('');
  $('#q').value = st.q;
  if (!rows.length) { $('#state-error').classList.add('on'); $('#resultWrap').hidden = true; $('#resultCount').textContent = ''; return; }
  render();
});
