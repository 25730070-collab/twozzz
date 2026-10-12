// 화면 전환 · 탭 · 상태 영역 · TOP 버튼 (와이어프레임용 최소 동작)
// JSON 연결은 다음 주차에 진행. 이번 주차는 구조·클래스·id만 확정한다.

const TAB_OF = { home: 'home', list: 'list', detail: 'list', my: 'my' };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function go(id) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === TAB_OF[id]));
  $('.tabbar').style.display = id === 'detail' ? 'none' : 'flex';
  $('.ic.back').style.display = id === 'detail' ? 'inline-block' : 'none';
  window.scrollTo(0, 0);
  history.replaceState(null, '', '#' + id);
}

document.addEventListener('click', e => {
  // 즐겨찾기 해제 · 최근검색 삭제 (카드 클릭 이동보다 먼저 처리)
  const del = e.target.closest('.chip.del');
  if (del) {
    del.closest('.card').remove();
    syncEmptyStates();
    return;
  }

  // 화면 전환
  const g = e.target.closest('[data-go]');
  if (g) return go(g.dataset.go);

  // 마이 탭 (즐겨찾기 · 최근검색)
  const t = e.target.closest('[data-tab]');
  if (t) {
    const wrap = t.closest('.screen');
    $$('.tabs button', wrap).forEach(b => b.classList.toggle('on', b === t));
    $$('.pane', wrap).forEach(p => p.classList.toggle('on', p.dataset.pane === t.dataset.tab));
    return;
  }

  // 홈 : 모드 선택 (routeMode)
  const m = e.target.closest('[data-mode]');
  if (m) {
    $$('#routeMode .chip').forEach(c => c.classList.toggle('on', c === m));
    return;
  }

  // 상세 : 즐겨찾기 토글
  if (e.target.id === 'favBtn') {
    const on = e.target.dataset.fav === 'true';
    e.target.dataset.fav = String(!on);
    e.target.textContent = !on ? '★ 즐겨찾기 됨' : '☆ 즐겨찾기 저장';
    $('#state-save-done').classList.toggle('on', !on);
    if (!on) setTimeout(() => $('#state-save-done').classList.remove('on'), 1800);
    return;
  }

  // 목록 : 마지막 조건 해제 (결과없음 상태에서) · 다시 시도 (오류 상태에서)
  if (e.target.id === 'clearFilter') {
    $$('.panel .opt.on').forEach(o => o.classList.remove('on'));
    $$('#list .state').forEach(s => s.classList.remove('on'));
    applyListFilters();
    return;
  }
  if (e.target.id === 'retryList') {
    $$('#list .state').forEach(s => s.classList.remove('on'));
    applyListFilters();
    return;
  }

  // 최근검색 전체 삭제
  if (e.target.id === 'clearAllRecent') {
    $$('#recentList .card').forEach(c => c.remove());
    syncEmptyStates();
    return;
  }

  // 위험 구간 : 필터 버튼 (드롭다운 열기/닫기)
  const filterBtn = e.target.closest('#filterRiskBtn, #filterRoadBtn');
  if (filterBtn) {
    const panel = filterBtn.nextElementSibling;
    const wasOn = panel.classList.contains('on');
    $$('.panel').forEach(p => p.classList.remove('on'));
    panel.classList.toggle('on', !wasOn);
    return;
  }

  // 위험 구간 : 필터 옵션 선택 (다중 선택)
  const opt = e.target.closest('.panel .opt');
  if (opt) {
    opt.classList.toggle('on');
    applyListFilters();
    return;
  }

  // 위험 구간 : 정렬 전환 (사고많은순 ↔ 기본)
  if (e.target.id === 'sortChip') {
    const next = e.target.dataset.sort === 'count' ? 'default' : 'count';
    e.target.dataset.sort = next;
    e.target.textContent = (next === 'count' ? '사고많은순' : '기본') + ' ▾';
    e.target.classList.toggle('on', next === 'count');
    applyListFilters();
    return;
  }

  // 위험 구간 : 필터·정렬 초기화
  if (e.target.id === 'resetFilter') {
    $$('.panel .opt.on').forEach(o => o.classList.remove('on'));
    $('#sortChip').dataset.sort = 'default';
    $('#sortChip').textContent = '사고많은순 ▾';
    $('#sortChip').classList.remove('on');
    applyListFilters();
    return;
  }

  // 드롭다운 바깥을 클릭하면 패널 닫기
  if (!e.target.closest('.dropdown')) $$('.panel').forEach(p => p.classList.remove('on'));
});

// 위험 구간 : 필터·정렬을 실제 카드 목록에 적용
function applyListFilters() {
  const riskOn = $$('#filterRiskPanel .opt.on').map(o => o.dataset.riskOpt);
  const roadOn = $$('#filterRoadPanel .opt.on').map(o => o.dataset.roadOpt);
  const sortByCount = $('#sortChip').dataset.sort === 'count';

  const cards = $$('#resultList .card');
  let visible = 0, highRisk = 0;
  cards.forEach(card => {
    const risk = card.querySelector('.riskLevel').dataset.risk;
    const road = card.querySelector('.roadType').textContent;
    const match = (riskOn.length === 0 || riskOn.includes(risk)) &&
                  (roadOn.length === 0 || roadOn.includes(road));
    card.style.display = match ? '' : 'none';
    if (match) { visible++; if (Number(risk) >= 3) highRisk++; }
  });

  if (sortByCount) {
    cards.sort((a, b) => Number(b.querySelector('.accidentCount').textContent) - Number(a.querySelector('.accidentCount').textContent));
  } else {
    cards.sort((a, b) => a.dataset.segmentId.localeCompare(b.dataset.segmentId));
  }
  cards.forEach(c => $('#resultList').appendChild(c));

  $('#resultCount').textContent = `총 ${visible}개 구간 · 위험 구간 ${highRisk}곳 포함`;
  $('#state-empty').classList.toggle('on', visible === 0);
  $('#resultList').classList.toggle('on', visible > 0);
}

// 즐겨찾기 · 최근검색이 0건이 되면 저장없음 상태를 보여준다
function syncEmptyStates() {
  $('#state-save-empty').classList.toggle('on', $$('#favoriteList .card').length === 0);
  $('#state-recent-empty').classList.toggle('on', $$('#recentList .card').length === 0);
}

// 홈 : 출발지 · 도착지 둘 다 입력해야 경로탐색 버튼 활성화
function syncFind() {
  const ok = $('#origin').value.trim() && $('#destination').value.trim();
  $('#find').disabled = !ok;
}
$('#origin').addEventListener('input', syncFind);
$('#destination').addEventListener('input', syncFind);

// TOP 버튼
const topBtn = $('.totop');
addEventListener('scroll', () => topBtn.classList.toggle('show', scrollY > 200));
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

// 상태 영역 확인용 (실제 전환은 JSON 연결 주차에서 구현)
console.log('Safe Drive app.js loaded — state areas:', $$('.state').map(s => s.id));

const h = location.hash.slice(1);
go(h in TAB_OF ? h : 'home');
syncFind();
syncEmptyStates();
applyListFilters();
