/* home.js — 홈: 경로 비교(주 행동) · 위험 구간 즐겨찾기 · 사고 많은 구간 · 지역별 (모두 data/*.json 의 실제 데이터에서 계산) */

/* 경로 비교 : 출발지·도착지 → compare.html */
const ro = $('#ro'), rd = $('#rd'), goRoute = $('#goRoute');
const syncRoute = () => { goRoute.disabled = !(ro.value.trim() && rd.value.trim()); };
[ro, rd].forEach(el => { el.addEventListener('input', syncRoute); el.addEventListener('keydown', e => { if (e.key === 'Enter' && !goRoute.disabled) goRoute.click(); }); });
attachSuggest(ro, { onPick: () => { if (!rd.value.trim()) rd.focus(); } }); attachSuggest(rd);
$('#useMe').addEventListener('click', () => { ro.value = '내 위치'; syncRoute(); rd.focus(); });
goRoute.addEventListener('click', () => { location.href = `${BASE}compare.html?${pair(ro.value.trim(), rd.value.trim())}`; });

function paintFavs(rows) {
  const favs = getFavs().map(f => f.kind === 'route' ? routeCard(f) : (rows.find(s => s.segmentId === f.segmentId) ? segCard(rows.find(s => s.segmentId === f.segmentId)) : '')).filter(Boolean);
  $('#favPreview').innerHTML = favs.slice(0, 3).join('');
  $('#favBox').hidden = favs.length === 0;
}

function paintData(rows) {
  rows = rows.filter(s => !isNil(s.accidentCount));
  if (!rows.length) {
    const none = emptyState({ title: '위험 구간 데이터를 불러오지 못했어요', tips: ['잠시 후 다시 시도해 주세요'], actions: [{ id: 'reloadData', label: '다시 시도' }] });
    ['#topList', '#guStats'].forEach(id => { $(id).innerHTML = none; });
    return;
  }
  paintFavs(rows);

  /* 사고 많은 구간 TOP 5 */
  $('#topList').innerHTML = [...rows].sort((a, b) => b.accidentCount - a.accidentCount).slice(0, 5).map((s, i) =>
    `<div class="card" data-href="${segUrl(s.segmentId)}">
      <span class="rank-n ${i < 3 ? 'top' : ''}">${i + 1}</span>
      <div><b class="roadName">${esc(s.roadName)}</b><p class="mu">${guOf(s)} · 사고 <span class="accidentCount">${s.accidentCount}</span>건</p></div>
      <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span></div>`).join('');

  /* 지역별 사고 건수 TOP 5 — 누르면 그 지역의 구간 목록 */
  const byGu = {};
  rows.forEach(s => { byGu[guOf(s)] = (byGu[guOf(s)] || 0) + s.accidentCount; });
  const guRows = Object.entries(byGu).sort((a, b) => b[1] - a[1]), max = guRows[0][1];
  $('#guStats').innerHTML = guRows.slice(0, 5).map(([g, n]) =>
    `<div class="stat" data-href="${BASE}list.html?q=${encodeURIComponent(g)}"><span class="nm">${esc(g)}</span><span class="bar"><i style="width:${Math.round(n / max * 100)}%"></i></span><span class="v">${n}건</span></div>`).join('');
}

$('#topList').innerHTML = $('#guStats').innerHTML = '<p class="mu" style="padding:12px 0">불러오는 중…</p>';
loadHazards().then(paintData);
document.addEventListener('click', e => { if (e.target.id === 'reloadData') location.reload(); });
