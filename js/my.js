/* my.js — 마이: 프로필 · 즐겨찾기 / 최근검색 / 연습기록 (눌러서 서비스로 이동 · 삭제) */
const user = store.get(KEY.user);
if (user) {
  $('#profileName').textContent = `${user.nickname} 님`;
  $('#profileSub').textContent = user.email;
  $('#profileBtn').textContent = '정보 삭제';
  $('#profileBtn').dataset.action = 'logout';
}

const delBtn = (id, kind, label, text) => `<button class="chip del" data-id="${id}" data-kind="${kind}" aria-label="${label}">${text}</button>`;

function favCard(f) {
  if (f.kind === 'segment') {
    const s = segById(f.segmentId); if (!s) return '';
    return `<div class="card" data-href="${segUrl(s.segmentId)}">
      <div><b>${esc(s.roadName)}</b><p class="mu">구간 · 사고 ${s.accidentCount}건 · ${guOf(s)} · 저장일 ${f.savedAt}</p></div>
      ${levelBadge(s.riskLevel)}${delBtn(f.id, 'fav', '즐겨찾기 해제', '해제')}</div>`;
  }
  return `<div class="card" data-href="${compareUrl(f)}">
    <div><b>${esc(f.origin)} → ${esc(f.destination)}</b><p class="mu">경로 비교로 이동 · 저장일 ${f.savedAt}</p></div>
    ${delBtn(f.id, 'fav', '즐겨찾기 해제', '해제')}</div>`;
}
const recentCard = r => `<div class="card" data-href="${compareUrl(r)}">
  <div><b>${esc(r.origin)} → ${esc(r.destination)}</b><p class="mu">검색 ${r.at}</p></div>
  ${delBtn(r.id, 'recent', '최근 검색 삭제', '✕')}</div>`;
const drillCard = r => `<div class="card" data-href="${previewUrl(r, r.routeType)}">
  <div><b>${esc(r.origin)} → ${esc(r.destination)}</b><p class="mu">${TYPE_LABEL[r.routeType]} · 주의 지점 ${r.points}곳 연습 · ${r.at}</p></div>
  ${delBtn(r.id, 'drill', '연습 기록 삭제', '✕')}</div>`;

function paint() {
  const favs = getFavs(), recent = getRecent(), drills = getDrills();
  $('#favoriteList').innerHTML = favs.map(favCard).join('');
  $('#recentList').innerHTML = recent.map(recentCard).join('');
  $('#drillList').innerHTML = drills.map(drillCard).join('');
  $('#favCount').textContent = favs.length;
  $('#recentCount').textContent = recent.length;
  $('#drillCount').textContent = drills.length;
  $('#statDrill').textContent = drills.length;
  $('#statPoints').textContent = drills.reduce((a, x) => a + x.points, 0);
  $('#state-save-empty').classList.toggle('on', favs.length === 0);
  $('#state-recent-empty').classList.toggle('on', recent.length === 0);
  $('#state-drill-empty').classList.toggle('on', drills.length === 0);
  $('#favoriteList').hidden = favs.length === 0;
  $('#recentWrap').hidden = recent.length === 0;
  $('#drillWrap').hidden = drills.length === 0;
}

const KEY_OF = { fav: KEY.fav, recent: KEY.recent, drill: KEY.drill };
const GET_OF = { fav: getFavs, recent: getRecent, drill: getDrills };

document.addEventListener('click', e => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b === tab));
    $$('.pane').forEach(x => x.classList.toggle('on', x.dataset.pane === tab.dataset.tab));
    return;
  }
  const del = t.closest('.chip.del');
  if (del) {
    const k = del.dataset.kind;
    store.set(KEY_OF[k], GET_OF[k]().filter(x => x.id !== del.dataset.id));
    paint(); return;
  }
  if (t.id === 'clearAllRecent') { store.set(KEY.recent, []); paint(); return; }
  if (t.id === 'clearAllDrill') { store.set(KEY.drill, []); paint(); return; }
  if (t.id === 'profileBtn') {
    if (t.dataset.action === 'logout') { store.remove(KEY.user); location.reload(); }
    else location.href = 'signup.html';
  }
});

$('#courseList').innerHTML = COURSES.map(c => {
  const r = ROUTES.find(x => x.id === c.routeId);
  return `<div class="card" data-href="${compareUrl(r)}"><div><b>${c.title}</b>
    <p class="mu">${c.desc}</p></div><span class="mu">›</span></div>`;
}).join('');
$('#learnList').innerHTML = LEARN.map(learnCard).join('');
paint();
