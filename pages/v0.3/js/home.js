/* home.js — 상단: 위험 구간 검색(액션) / 하단: 큐레이션 (모두 data/*.json 의 실제 데이터에서 계산) */
const qEl = $('#q'), find = $('#find');

qEl.addEventListener('input', () => { find.disabled = !qEl.value.trim(); });
qEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !find.disabled) find.click(); });
find.addEventListener('click', () => {
  const q = qEl.value.trim();
  if (!q) return;
  addRecent(q);
  location.href = `${BASE}list.html?q=${encodeURIComponent(q)}`;
});

/* 경로 비교 : 출발지·도착지 → compare.html */
const ro = $('#ro'), rd = $('#rd'), goRoute = $('#goRoute');
const syncRoute = () => { goRoute.disabled = !(ro.value.trim() && rd.value.trim()); };
[ro, rd].forEach(el => { el.addEventListener('input', syncRoute); el.addEventListener('keydown', e => { if (e.key === 'Enter' && !goRoute.disabled) goRoute.click(); }); });
$('#useMe').addEventListener('click', () => { ro.value = '내 위치'; syncRoute(); rd.focus(); });
goRoute.addEventListener('click', () => { location.href = `${BASE}compare.html?${pair(ro.value.trim(), rd.value.trim())}`; });

/* 최근 검색 · 즐겨찾기 */
const recent = getRecent();
$('#quickRecent').innerHTML = recent.slice(0, 6).map(r =>
  `<a class="chip" href="${BASE}list.html?q=${encodeURIComponent(r.q)}">${esc(r.q)}</a>`).join('');
$('#state-quick-empty').classList.toggle('on', recent.length === 0);

function paintFavs(rows) {
  const favs = getFavs().filter(f => f.kind === 'segment').map(f => rows.find(s => s.segmentId === f.segmentId)).filter(Boolean);
  $('#favPreview').innerHTML = favs.slice(0, 3).map(segCard).join('');
  $('#state-fav-empty').classList.toggle('on', favs.length === 0);
  $('#favBox').hidden = false;
  $('#favPreview').hidden = favs.length === 0;
}

function paintData(rows) {
  rows = rows.filter(s => !isNil(s.accidentCount));
  if (!rows.length) {
    const none = emptyState({ title: '위험 구간 데이터를 불러오지 못했어요', tips: ['data/ 폴더의 JSON 파일과 배포 주소를 확인해 주세요', '파일을 더블클릭해 열면(file://) 불러올 수 없어요'], actions: [{ id: 'reloadData', label: '다시 시도' }] });
    ['#topList', '#guStats', '#guChips'].forEach(id => { $(id).innerHTML = none; });
    return;
  }
  paintFavs(rows);

  /* 추천 카드 (가로 넘김) : 사고 많은 구간 · 가장 최근 기준 연도 구간 — 사진이 없어 회색 자리로 표시 */
  const gcard = s => `<div class="gcard" data-href="${segUrl(s.segmentId)}">
    <div class="thumb" aria-hidden="true">이미지 없음</div>
    <div class="body"><b class="roadName">${esc(s.roadName)}</b><span class="mu">${guOf(s)} · 사고 ${s.accidentCount}건</span>
    <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span></div></div>`;
  $('#stripTop').innerHTML = [...rows].sort((a, b) => b.accidentCount - a.accidentCount).slice(0, 12).map(gcard).join('');
  const lastYear = Math.max(...rows.map(s => Number(s.year) || 0));
  $('#stripNew').innerHTML = rows.filter(s => Number(s.year) === lastYear).sort((a, b) => b.accidentCount - a.accidentCount).slice(0, 12).map(gcard).join('');
  $('#stripNew').previousElementSibling.querySelector('h3').textContent = `🕑 ${lastYear}년 기준 구간`;
  syncStripBtns();

  /* TOP 10 */
  $('#topList').innerHTML = [...rows].sort((a, b) => b.accidentCount - a.accidentCount).slice(0, 10).map((s, i) =>
    `<div class="card" data-href="${segUrl(s.segmentId)}">
      <span class="rank-n ${i < 3 ? 'top' : ''}">${i + 1}</span>
      <div><b class="roadName">${esc(s.roadName)}</b><p class="mu">${guOf(s)} · 사고 <span class="accidentCount">${s.accidentCount}</span>건</p></div>
      <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span></div>`).join('');

  /* 구별 사고 건수 · 구간 수 */
  const byGu = {}, cntGu = {};
  rows.forEach(s => { byGu[guOf(s)] = (byGu[guOf(s)] || 0) + s.accidentCount; cntGu[guOf(s)] = (cntGu[guOf(s)] || 0) + 1; });
  const guRows = Object.entries(byGu).sort((a, b) => b[1] - a[1]), max = guRows[0][1];
  $('#guStats').innerHTML = guRows.slice(0, 10).map(([g, n]) =>
    `<div class="stat"><span class="nm">${esc(g)}</span><span class="bar"><i style="width:${Math.round(n / max * 100)}%"></i></span><span class="v">${n}건</span></div>`).join('');
  $('#guChips').innerHTML = Object.entries(cntGu).sort((a, b) => b[1] - a[1]).map(([g, n]) =>
    `<a class="chip" href="${BASE}list.html?q=${encodeURIComponent(g)}">${esc(g)} ${n}</a>`).join('');

}

$('#topList').innerHTML = $('#guStats').innerHTML = '<p class="mu" style="padding:12px 0">불러오는 중…</p>';
loadHazards().then(paintData);
document.addEventListener('click', e => { if (e.target.id === 'reloadData') location.reload(); });

/* 가로 넘김 : 이전/다음 버튼 · 방향키 · 손가락 스와이프(스크롤) */
function syncStripBtns() {
  $$('.strip-btn').forEach(b => {
    const el = $('#' + b.dataset.strip); if (!el) return;
    b.disabled = b.dataset.dir === '-1' ? el.scrollLeft <= 2 : el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.strip-btn'); if (!b) return;
  const el = $('#' + b.dataset.strip); el.scrollBy({ left: +b.dataset.dir * (el.clientWidth - 40), behavior: 'smooth' });
});
$$('.hstrip').forEach(el => {
  el.addEventListener('scroll', syncStripBtns, { passive: true });
  el.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); el.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * 160, behavior: 'smooth' }); } });
});
