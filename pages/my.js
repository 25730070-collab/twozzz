/* my.js — 마이: 프로필 · 즐겨찾기 / 최근검색 / 내 제보 (눌러서 이동 · 삭제) */
const user = store.get(KEY.user);
if (user) {
  $('#profileName').textContent = `${user.nickname} 님`;
  $('#profileSub').textContent = user.email;
  $('#profileBtn').textContent = '정보 삭제';
  $('#profileBtn').dataset.action = 'logout';
}

const delBtn = (id, kind, label, text) => `<button class="chip del" data-id="${id}" data-kind="${kind}" aria-label="${label}">${text}</button>`;

/* 즐겨찾기 : 구간 데이터는 JSON에서 찾아 보여 준다 (JSON에서 사라진 구간은 '정보 없음' 카드) */
function favCard(f) {
  const s = segById(f.segmentId);
  if (!s) return `<div class="card plain"><div><b>구간 정보를 찾을 수 없어요</b><p class="mu">${esc(f.segmentId)} · 저장일 ${f.savedAt}</p></div>${delBtn(f.id, 'fav', '즐겨찾기 해제', '해제')}</div>`;
  return `<div class="card" data-href="${segUrl(s.segmentId)}">
    <div><b>${esc(s.roadName)}</b><p class="mu">${guOf(s)} · ${isNil(s.accidentCount) ? '사고 건수 정보 없음' : `사고 ${s.accidentCount}건`} · 저장일 ${f.savedAt}</p></div>
    <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span>${delBtn(f.id, 'fav', '즐겨찾기 해제', '해제')}</div>`;
}
const recentCard = r => `<div class="card" data-href="${BASE}list.html?q=${encodeURIComponent(r.q)}">
  <div><b>${esc(r.q)}</b><p class="mu">검색 ${r.at}</p></div>
  ${delBtn(r.id, 'recent', '최근 검색 삭제', '✕')}</div>`;
const reportCard = s => `<div class="card" data-href="${segUrl(s.segmentId)}">
  <div><b>${esc(s.roadName)}</b><p class="mu">${isNil(s.accidentCount) ? '사고 건수 정보 없음' : `사고 ${s.accidentCount}건`} · 제보 ${s.createdAt}</p></div>
  <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span>${delBtn(s.segmentId, 'report', '제보 삭제', '✕')}</div>`;

function paint() {
  const favs = getFavs().filter(f => f.kind === 'segment'), recent = getRecent(), reports = getReports();
  $('#favoriteList').innerHTML = favs.map(favCard).join('');
  $('#recentList').innerHTML = recent.map(recentCard).join('');
  $('#reportList').innerHTML = reports.map(reportCard).join('');
  $('#favCount').textContent = $('#statFav').textContent = favs.length;
  $('#recentCount').textContent = recent.length;
  $('#reportCount').textContent = $('#statReport').textContent = reports.length;
  $('#state-save-empty').classList.toggle('on', favs.length === 0);
  $('#state-recent-empty').classList.toggle('on', recent.length === 0);
  $('#state-report-empty').classList.toggle('on', reports.length === 0);
  $('#favoriteList').hidden = favs.length === 0;
  $('#recentWrap').hidden = recent.length === 0;
  $('#reportWrap').hidden = reports.length === 0;
}

const KEY_OF = { fav: KEY.fav, recent: KEY.recent, report: KEY.report };
const GET_OF = { fav: getFavs, recent: getRecent, report: getReports };

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
    store.set(KEY_OF[k], GET_OF[k]().filter(x => (x.id || x.segmentId) !== del.dataset.id));
    paint(); return;
  }
  if (t.id === 'clearAllRecent') { store.set(KEY.recent, []); paint(); return; }
  if (t.id === 'profileBtn') {
    if (t.dataset.action === 'logout') { store.remove(KEY.user); location.reload(); }
    else location.href = 'signup.html';
  }
});

loadHazards().then(paint, paint);
