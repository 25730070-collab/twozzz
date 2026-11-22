/* common.js — 선택자 · 렌더 헬퍼 · 출처/필드 태그 · 카드 이동 · 뒤로가기 · 가입 칩 · TOP 버튼 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const BASE = document.body.dataset.base || '';                       // index.html: 'pages/', pages/*.html: ''
const HOME_URL = document.body.dataset.page === 'home' ? 'index.html' : '../index.html';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = () => new URLSearchParams(location.search);
const guOf = s => (s.address || '').split(' ')[1] || '구 정보 없음';

/* ---------- 아이콘 : 한 가지 선형 스타일 (24px · 선 1.9) ---------- */
const ICON_PATH = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9Z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/>',
  straight: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  left: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
  right: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v5"/>',
  uturn: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  share: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'
};
const ico = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATH[n] || ''}</svg>`;

const segById = id => (typeof _hazards !== 'undefined' && _hazards ? _hazards : []).find(s => s.segmentId === id);

/* ---------- 주소 ---------- */
const segUrl = id => `${BASE}detail.html?seg=${encodeURIComponent(id)}`;

/* ---------- 위험 계산 ---------- */
/* ---------- 렌더 헬퍼 ---------- */
const levelBadge = n => `<span class="bg r${n} riskLevel" data-risk="${n}">${n}등급</span>`;

/* 데이터 출처 태그 : J = JSON 파일(static), A = API 호출(api) */
const SRC = { static: { k: 'j', t: 'J', n: 'JSON 파일 데이터' }, api: { k: 'a', t: 'A', n: 'API 호출 데이터' }, user: { k: 'u', t: 'U', n: '사용자 제보 데이터' } };
const srcBadge = s => { const o = SRC[s.source] || SRC.static;
  return `<span class="src ${o.k}" data-source="${s.source}" title="${o.n}" aria-label="${o.n}">${o.t}</span>`; };

/* null·빈 값 표준 표기 : '정보 없음' + [미입력/추정] 태그 */
const isNil = v => v === null || v === undefined || v === '';
const infoText = (v, unit = '') => isNil(v) ? '정보 없음' : `${esc(v)}${unit}`;
const typeTag = (label, k) => `<span class="type-tag ${k}">${label}</span>`;
/* 값이 비면 '미입력' 태그 */
const fieldTag = (s, key) => isNil(s[key]) ? typeTag('미입력', 'nil') : '';

/* 필드 유형 : meta 의 api → real → dummy 순으로 판단 (meta 가 없으면 출처로 추정) */
function defaultMeta(s) {
  const all = ['roadName', 'accidentCount', 'riskLevel', 'address', 'lat', 'lng', 'year'];
  if (s.source === 'api') return { source: 'api', real: ['roadName', 'accidentCount', 'address', 'lat', 'lng', 'year'], derived: ['riskLevel'], dummy: [], api: [] };
  if (s.source === 'user') return { source: 'user', real: [], dummy: [], api: [], user: all };
  return { source: 'json', real: ['roadName', 'accidentCount', 'address', 'lat', 'lng', 'year'], derived: ['riskLevel'], dummy: [], api: [] };
}
function fieldType(s, key) {
  const m = s.meta || defaultMeta(s);
  if ((m.api || []).includes(key)) return 'api';
  if ((m.real || []).includes(key)) return 'real';
  if ((m.user || []).includes(key)) return 'user';
  if ((m.derived || []).includes(key)) return 'derived';
  if ((m.dummy || []).includes(key)) return 'dummy';
  return '';
}
const FIELD_LABEL = { real: '실제', derived: '가공', dummy: '더미', api: 'API', user: '제보' };
const typeBadge = (s, key) => { const t = fieldType(s, key); return t ? `<span class="type-tag ft-${t}">${FIELD_LABEL[t]}</span>` : ''; };

/* 표준 빈 화면 : 아이콘 + 한 줄 설명 + 해결 방법 안내 + 버튼 (검색 결과 없음·데이터 없음 공통) */
const EMPTY_ICON = '<svg viewBox="0 0 120 72" width="120" height="72" aria-hidden="true"><rect x="1" y="1" width="118" height="70" rx="14" fill="#f4f6f5"/><path d="M46 70 54 8M74 70 66 8" stroke="#ccd5d0" stroke-width="3" fill="none"/><path d="M60 62V52M60 42V32M60 22V12" stroke="#ccd5d0" stroke-width="3" stroke-linecap="round"/><circle cx="92" cy="26" r="11" fill="#fff" stroke="#0b8457" stroke-width="3"/><path d="m100 34 9 9" stroke="#0b8457" stroke-width="3" stroke-linecap="round"/></svg>';
function emptyState({ title, tips = [], actions = [] }) {
  return `<div class="empty">${EMPTY_ICON}<b>${title}</b>
    ${tips.length ? `<ul>${tips.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
    <div class="empty-act">${actions.map(a => a.href ? `<a class="btn" href="${a.href}">${a.label}</a>` : `<button class="btn" id="${a.id}">${a.label}</button>`).join('')}</div></div>`;
}

function segCard(s) {
  return `<div class="card" data-href="${segUrl(s.segmentId)}" data-segment-id="${s.segmentId}">
    <div><b class="roadName">${esc(s.roadName)}</b>
      <p class="mu">${guOf(s)}${isNil(s.year) ? '' : ` · ${s.year}년`} · ${isNil(s.accidentCount) ? '사고 건수 정보 없음' : `사고 <span class="accidentCount">${s.accidentCount}</span>건`}</p></div>
    <span class="tags">${srcBadge(s)}${levelBadge(s.riskLevel)}</span></div>`;
}

/* ---------- 공통 동작 ---------- */
/* 카드 클릭 이동 (카드 안의 버튼·링크는 각자 처리) */
document.addEventListener('click', e => {
  if (e.target.closest('button, a, input, label')) return;
  const c = e.target.closest('[data-href]');
  if (c) location.href = c.dataset.href;
});

/* ---------- 공통 셸 : 글로벌 헤더 · 하단 탭바 · 로그아웃 확인 · 토스트 (모든 화면이 같은 코드로 만든다) ---------- */
const HOME_PAGE = document.body.dataset.page === 'home';
const HREF = { home: HOME_URL, list: `${BASE}list.html`, route: `${BASE}route.html`, my: `${BASE}my.html`, data: `${BASE}data.html`, signup: `${BASE}signup.html` };
const TAB_ON = { home: 'home', route: 'route', compare: 'route', preview: 'route', drive: 'route', list: 'list', detail: 'list', my: 'my', report: 'my', data: 'my', signup: 'my' };

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
const flash = msg => { try { sessionStorage.setItem('sd_flash', msg); } catch {} };

function logout() {                                   // 서버 인증이 없으므로 이 기기의 가입 정보만 지운다 (즐겨찾기·제보는 그대로)
  store.remove(KEY.user);
  flash('로그아웃했어요');
  location.reload();
}

function buildShell() {
  const user = store.get(KEY.user);
  /* 헤더 : 로고 · 로그인/로그아웃 아이콘 */
  const hd = $('.app-header');
  if (hd) {
    hd.innerHTML = `<a class="logo" href="${HOME_URL}" aria-label="Safe Drive 홈"><span class="logo-mark">${ico('route')}</span>Safe Drive</a>
      ${user ? `<button class="hd-btn on" id="authBtn" aria-label="로그아웃" title="${esc(user.nickname)} · 로그아웃">${ico('logout')}</button>`
             : `<a class="hd-btn" id="authBtn" href="${HREF.signup}" aria-label="로그인·가입" title="로그인·가입">${ico('login')}</a>`}`;
  }
  addEventListener('keydown', e => { if (e.key === 'Escape') closeConfirm(); });
  /* 로그아웃 확인 */
  const md = document.createElement('div'); md.className = 'modal'; md.id = 'logoutModal'; md.setAttribute('role', 'dialog'); md.setAttribute('aria-modal', 'true'); md.setAttribute('aria-label', '로그아웃 확인');
  md.innerHTML = `<div class="modal-box"><h3>로그아웃할까요?</h3><p class="mu">이 기기의 가입 정보만 지워져요. 즐겨찾기와 제보는 그대로 남아요.</p>
    <div class="row"><button class="btn" id="lgNo">취소</button><button class="btn dk" id="lgYes">로그아웃</button></div></div>`;
  document.body.appendChild(md);
  const openConfirm = () => { md.classList.add('on'); $('#lgNo').focus(); };
  window.closeConfirm = () => md.classList.remove('on');
  md.addEventListener('click', e => { if (e.target === md) closeConfirm(); });
  $('#lgNo').addEventListener('click', closeConfirm);
  $('#lgYes').addEventListener('click', logout);
  const ab = $('#authBtn'); if (user) ab.addEventListener('click', openConfirm);
  window.openLogoutConfirm = openConfirm;
  /* 하단 탭바 (모바일) */
  const tb = $('.tabbar');
  if (tb) {
    const tab = (id, label, icon, href) => { const on = TAB_ON[document.body.dataset.page] === id; return `<a href="${href}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${ico(icon)}${label}</a>`; };
    tb.setAttribute('aria-label', '하단 메뉴');
    tb.innerHTML = tab('home', '홈', 'home', HREF.home) + tab('route', '경로 찾기', 'route', HREF.route) + tab('list', '위험 구간', 'pin', HREF.list) + tab('my', '마이', 'user', HREF.my);
  }
  /* 서브 바 뒤로가기 아이콘 */
  const bb = $('#backBtn'); if (bb) bb.innerHTML = ico('back');
  /* 로그아웃 직후 안내 */
  try { const m = sessionStorage.getItem('sd_flash'); if (m) { sessionStorage.removeItem('sd_flash'); toast(m); } } catch {}
}
buildShell();
$$('.state').forEach(el => { if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite'); });   // 불러오는 중·오류 문구가 바뀌면 보조기기가 읽어 준다
$$('.more').forEach(a => { a.innerHTML = ico('next'); });   // 더보기는 글자 대신 화살표 아이콘

/* 서브 화면 뒤로가기 (로고는 항상 홈으로) */
const backBtn = $('#backBtn');
if (backBtn) backBtn.addEventListener('click', () => {
  if (document.referrer && history.length > 1) history.back();
  else location.href = backBtn.dataset.fallback || HOME_URL;
});

/* TOP 버튼 */
const topBtn = document.createElement('button');
topBtn.className = 'totop';
topBtn.setAttribute('aria-label', '맨 위로');
topBtn.innerHTML = ico('up');
document.body.appendChild(topBtn);
addEventListener('scroll', () => topBtn.classList.toggle('show', scrollY > 400));
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));


/* ---------- 경로 ---------- */
const routeCard = (r, extra = '') => `<div class="card" data-href="${BASE}compare.html?origin=${encodeURIComponent(r.origin)}&destination=${encodeURIComponent(r.destination)}">
  <div><b>${esc(r.origin)} → ${esc(r.destination)}</b><p class="mu">빠른 경로 · 안전 경로 비교 ${extra}</p></div><span class="go">${ico('next', 's')}</span></div>`;
const TYPE_LABEL = { fast: '빠른 경로', safe: '안전 경로' };
const pair = (o, d) => `origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`;
const compareUrl = r => `${BASE}compare.html?${pair(r.origin, r.destination)}`;
const previewUrl = (r, type) => `${BASE}preview.html?${pair(r.origin, r.destination)}&type=${type}`;
const driveUrl = (r, type) => `${BASE}drive.html?${pair(r.origin, r.destination)}&type=${type}`;
/* 경로를 만들 수 없을 때 표준 안내 */
function failView(e, back = '../index.html') {
  const l = $('#state-loading'); if (l) l.classList.remove('on');
  const html = emptyState({ title: '경로를 만들 수 없어요',
    tips: [esc(e && e.message ? e.message : String(e)), '출발지와 도착지를 확인하고 다시 시도해 주세요'], actions: [{ id: 'retryRoute', label: '다시 시도' }, { href: back, label: '다시 입력하기' }] });
  const title = $('main .route-title'), bar = $('#favRow');             // 제목 아래에 놓는다 (제목이 오류 카드 뒤로 밀리지 않게)
  if (bar) bar.hidden = true;                                           // 경로를 못 만들었으면 즐겨찾기·공유 버튼은 숨김
  if (title) title.insertAdjacentHTML('afterend', html); else ($('main') || document.body).insertAdjacentHTML('afterbegin', html);
  const retry = $('#retryRoute'); if (retry) retry.addEventListener('click', () => location.reload());
  console.warn('[경로 실패]', e);
}
/* 사고 다발지점 요약 문구 (실제 사고 건수 합) */
const hazardSum = st => st.hazards.length ? `사고 다발지점 ${st.hazards.length}곳 · 사고 ${st.score}건` : '지나는 사고 다발지점 없음';
