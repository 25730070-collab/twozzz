/* list.js — 위험 구간: 필터 · 정렬 · 더 보기 */
const PAGE = 20;
const st = { risk: new Set(), road: new Set(), sort: 'default', shown: PAGE };

function render() {
  let rows = SEGMENTS.filter(s =>
    (!st.risk.size || st.risk.has(String(s.riskLevel))) &&
    (!st.road.size || st.road.has(s.roadType)));
  if (st.sort === 'count') rows = [...rows].sort((a, b) => b.accidentCount - a.accidentCount);

  $('#resultList').innerHTML = rows.slice(0, st.shown).map(segCard).join('');
  const hi = rows.filter(s => s.riskLevel >= 3).length;
  $('#resultCount').textContent = `총 ${rows.length}개 구간 · 위험 구간 ${hi}곳 포함`;
  $('#moreBtn').hidden = rows.length <= st.shown;
  $('#moreBtn').textContent = `더 보기 (${Math.min(st.shown, rows.length)}/${rows.length})`;
  $('#state-empty').classList.toggle('on', rows.length === 0);
  $('#resultWrap').hidden = rows.length === 0;
}

document.addEventListener('click', e => {
  const t = e.target;
  const btn = t.closest('#filterRiskBtn, #filterRoadBtn');
  if (btn) {
    const panel = btn.nextElementSibling, was = panel.classList.contains('on');
    $$('.panel').forEach(x => x.classList.remove('on'));
    panel.classList.toggle('on', !was);
    return;
  }
  const opt = t.closest('.panel .opt');
  if (opt) {
    const set = opt.dataset.riskOpt ? st.risk : st.road, v = opt.dataset.riskOpt || opt.dataset.roadOpt;
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
    st.risk.clear(); st.road.clear(); st.sort = 'default'; st.shown = PAGE;
    $$('.panel .opt.on').forEach(x => x.classList.remove('on'));
    $('#sortChip').textContent = '기본순 ▾'; $('#sortChip').classList.remove('on');
    render(); return;
  }
  if (t.id === 'moreBtn') { st.shown += PAGE; render(); return; }
  if (t.id === 'retryList') { $('#state-error').classList.remove('on'); render(); return; }
  if (!t.closest('.dropdown')) $$('.panel').forEach(x => x.classList.remove('on'));
});

/* 하단 큐레이션 */
$('#courseList').innerHTML = ROUTES.map(r => routeCard(r)).join('');
$('#learnList').innerHTML = LEARN.map(learnCard).join('');
$('#tipList').innerHTML = TIPS.map(tipCard).join('');
render();
