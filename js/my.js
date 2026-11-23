/* my.js — 마이: 프로필 · 즐겨찾기 / 최근검색 / 내 제보 (눌러서 이동 · 삭제) */
/* ab***@gmail.com — 앞 2글자만 보인다 */
const maskEmail = e => { const [a, d] = String(e).split('@'); return a && d ? `${a.slice(0, 2)}${'*'.repeat(Math.max(a.length - 2, 1))}@${d}` : e; };
const user = store.get(KEY.user);
$('#avatar').innerHTML = ico('user');
if (user) {
  $('#profileName').textContent = `${user.nickname} 님`;
  $('#profileSub').textContent = user.server ? maskEmail(user.email) : user.email;      // 화면을 누가 어깨 너머로 봐도 이메일 전체는 안 보이게
  $('#profileBtn').textContent = '로그아웃';
  $('#profileBtn').dataset.action = 'logout';
}

/* 회원 서버 계정이면: 로그인이 아직 유효한지 확인하고, 회원 탈퇴를 보여 준다 */
if (user && user.server) {
  $('#withdrawRow').hidden = false;
  $('#storeNote').textContent = '닉네임·이메일·비밀번호(해시)·최근 검색·제보는 회원 서버 DB에 저장돼서 다른 기기에서도 볼 수 있어요. 즐겨찾기는 이 기기에만 저장돼요 (다른 기기로는 데이터 관리에서 옮겨요)';
  Account.me().catch(e => {                            // 만료·삭제된 계정이면 이 기기의 로그인 정보를 정리한다 (네트워크 오류일 땐 그대로 둔다)
    if (e.status === 401) { Account.clearSession(); flash('로그인이 만료됐어요. 다시 로그인해 주세요'); location.reload(); }
  });
  const md = document.createElement('div'); md.className = 'modal'; md.id = 'withdrawModal'; md.setAttribute('role', 'dialog'); md.setAttribute('aria-modal', 'true'); md.setAttribute('aria-label', '회원 탈퇴 확인');
  md.innerHTML = `<div class="modal-box"><h3>정말 탈퇴할까요?</h3><p class="mu">서버에 저장된 닉네임·이메일·비밀번호와 제보·최근 검색·로그인 기록이 바로 삭제돼요. 되돌릴 수 없어요. 이 기기의 즐겨찾기는 그대로 남아요.</p>
    <label class="mu" for="wdPw" style="display:block;margin-top:var(--sp3)">비밀번호를 입력해 주세요</label>
    <input class="in" id="wdPw" type="password" autocomplete="current-password" maxlength="64">
    <p class="note err" id="wdErr" role="alert" hidden></p>
    <div class="row"><button class="btn" id="wdNo">취소</button><button class="btn dk" id="wdYes">탈퇴하기</button></div></div>`;
  document.body.appendChild(md);
  const close = () => md.classList.remove('on');
  $('#withdrawRow').addEventListener('click', e => { e.preventDefault(); $('#wdErr').hidden = true; $('#wdPw').value = ''; md.classList.add('on'); $('#wdPw').focus(); });
  $('#wdNo').addEventListener('click', close);
  md.addEventListener('click', e => { if (e.target === md) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('#wdYes').addEventListener('click', async () => {
    const b = $('#wdYes'); b.disabled = true;
    try { await Account.withdraw($('#wdPw').value); Account.clearSession(); flash('탈퇴했어요. 서버의 계정·제보·검색 기록을 삭제했어요'); location.reload(); }
    catch (e) {
      if (e.status === 401) { Account.clearSession(); flash('이미 로그아웃된 상태예요'); return location.reload(); }
      $('#wdErr').textContent = e.message; $('#wdErr').hidden = false; b.disabled = false;
    }
  });
}

const delBtn = (id, kind, label) => `<button class="chip del" data-id="${id}" data-kind="${kind}" aria-label="${label}">${ico('close', 's')}</button>`;

/* 즐겨찾기 : 구간 데이터는 JSON에서 찾아 보여 준다 (JSON에서 사라진 구간은 '정보 없음' 카드) */
function favCard(f) {
  if (f.kind === 'route') return `<div class="card" data-href="${BASE}compare.html?${pair(f.origin, f.destination)}"><div><b>${esc(f.origin)} → ${esc(f.destination)}</b><p class="mu">경로 · 저장일 ${f.savedAt}</p></div><span class="tags"><span class="type-tag">경로</span></span>${delBtn(f.id, 'fav', '즐겨찾기 해제')}</div>`;
  const s = segById(f.segmentId);
  if (!s) return `<div class="card plain"><div><b>구간 정보를 찾을 수 없어요</b><p class="mu">${esc(f.segmentId)} · 저장일 ${f.savedAt}</p></div>${delBtn(f.id, 'fav', '즐겨찾기 해제')}</div>`;
  return `<div class="card" data-href="${segUrl(s.segmentId)}">
    <div><b>${esc(s.roadName)}</b><p class="mu">${guOf(s)} · ${isNil(s.accidentCount) ? '사고 건수 정보 없음' : `사고 ${s.accidentCount}건`} · 저장일 ${f.savedAt}</p></div>
    <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span>${delBtn(f.id, 'fav', '즐겨찾기 해제')}</div>`;
}
const recentCard = r => `<div class="card" data-href="${r.kind === 'route' ? `${BASE}compare.html?${pair(r.origin, r.destination)}` : `${BASE}list.html?q=${encodeURIComponent(r.q)}`}">
  <div><b>${r.kind === 'route' ? `${esc(r.origin)} → ${esc(r.destination)}` : esc(r.q)}</b><p class="mu">${r.kind === 'route' ? '경로' : '구간'} 검색 ${r.at}</p></div>
  ${delBtn(r.id, 'recent', '최근 검색 삭제')}</div>`;
const reportCard = s => `<div class="card" data-href="${segUrl(s.segmentId)}">
  <div><b>${esc(s.roadName)}</b><p class="mu">${isNil(s.accidentCount) ? '사고 건수 정보 없음' : `사고 ${s.accidentCount}건`} · 제보 ${s.createdAt}${s.updatedAt ? ` · 수정 ${s.updatedAt}` : ''}</p></div>
  <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span><a class="chip" href="report.html?edit=${encodeURIComponent(s.segmentId)}" aria-label="제보 수정">${ico('edit', 's')}</a>${delBtn(s.segmentId, 'report', '제보 삭제')}</div>`;

function paint() {
  const favs = getFavs(), recent = getRecent(), reports = getReports();
  $('#favoriteList').innerHTML = favs.map(favCard).join('');
  $('#recentList').innerHTML = recent.map(recentCard).join('');
  $('#reportList').innerHTML = reports.map(reportCard).join('');
  $('#favCount').textContent = favs.length;
  $('#recentCount').textContent = recent.length;
  $('#reportCount').textContent = reports.length;
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
    removeItem(del.dataset.kind, del.dataset.id).then(() => paint());
    paint(); return;
  }
  if (t.id === 'clearAllRecent') { clearRecent(); paint(); return; }
  if (t.id === 'profileBtn') {
    if (t.dataset.action === 'logout') openLogoutConfirm();
    else location.href = 'signup.html';
  }
});

syncUp().finally(() => loadHazards().then(paint, paint));       // 서버 계정이면: 못 올린 것을 올리고, 서버 것을 받아 온 뒤 그린다
