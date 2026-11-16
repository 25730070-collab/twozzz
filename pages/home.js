/* home.js — 상단: 경로 입력(액션) / 하단: 큐레이션 */
const origin = $('#origin'), destination = $('#destination'), find = $('#find');

const syncFind = () => { find.disabled = !(origin.value.trim() && destination.value.trim()); };
origin.addEventListener('input', syncFind);
destination.addEventListener('input', syncFind);
[origin, destination].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && !find.disabled) find.click(); }));

find.addEventListener('click', () => {
  const o = origin.value.trim(), d = destination.value.trim();
  if (!o || !d) return;
  addRecent(o, d);
  location.href = compareUrl({ origin: o, destination: d });
});

/* 최근 검색 · 즐겨찾기 */
const recent = getRecent();
$('#quickRecent').innerHTML = recent.slice(0, 6).map(r =>
  `<a class="chip" href="${compareUrl(r)}">${esc(r.origin)} → ${esc(r.destination)}</a>`).join('');
$('#state-quick-empty').classList.toggle('on', recent.length === 0);

const favRoutes = getFavs().filter(f => f.kind === 'route');
$('#favPreview').innerHTML = favRoutes.slice(0, 3).map(f => routeCard(f)).join('');
$('#state-fav-empty').classList.toggle('on', favRoutes.length === 0);
$('#favBox').hidden = favRoutes.length === 0;

/* 큐레이션 1 : 초보 연습 코스 */
$('#courseList').innerHTML = COURSES.map(c => {
  const r = ROUTES.find(x => x.id === c.routeId);
  return `<div class="mini course" data-href="${compareUrl(r)}">
    <b>${c.title}</b><p class="mu">${c.desc}</p>
    <div class="row">${c.tags.map(t => `<span class="chip">${t}</span>`).join('')}</div>
    <p class="mu" style="margin-top:6px">${esc(r.origin)} → ${esc(r.destination)}</p></div>`;
}).join('');

/* 큐레이션 2 : 사고 많은 구간 TOP 5 */
$('#topList').innerHTML = [...SEGMENTS].sort((a, b) => b.accidentCount - a.accidentCount).slice(0, 5).map((s, i) =>
  `<div class="card" data-href="${segUrl(s.segmentId)}">
    <span class="rank-n ${i < 3 ? 'top' : ''}">${i + 1}</span>
    <div><b class="roadName">${esc(s.roadName)}</b><p class="mu">${guOf(s)} · 사고 <span class="accidentCount">${s.accidentCount}</span>건</p></div>
    ${levelBadge(s.riskLevel)}</div>`).join('');

/* 큐레이션 3 : 상황별 대처법 (학습) */
$('#learnList').innerHTML = LEARN.map(learnCard).join('');

/* 큐레이션 4 : 구별 사고 건수 */
const byGu = {};
SEGMENTS.forEach(s => { byGu[guOf(s)] = (byGu[guOf(s)] || 0) + s.accidentCount; });
const guRows = Object.entries(byGu).sort((a, b) => b[1] - a[1]).slice(0, 7), max = guRows[0][1];
$('#guStats').innerHTML = guRows.map(([g, n]) =>
  `<div class="stat"><span class="nm">${g}</span><span class="bar"><i style="width:${Math.round(n / max * 100)}%"></i></span><span class="v">${n}건</span></div>`).join('');

$('#tipList').innerHTML = TIPS.map(tipCard).join('');
$('#myLoc').addEventListener('click', () => { origin.value = '내 위치'; syncFind(); destination.focus(); });
syncFind();
