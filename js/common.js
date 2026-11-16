/* common.js — 선택자 · 렌더 헬퍼 · 출처/필드 태그 · 카드 이동 · 뒤로가기 · 가입 칩 · TOP 버튼 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const BASE = document.body.dataset.base || '';                       // index.html: 'pages/', pages/*.html: ''
const HOME_URL = document.body.dataset.page === 'home' ? 'index.html' : '../index.html';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = () => new URLSearchParams(location.search);
const guOf = s => (s.address || '').split(' ')[1] || '구 정보 없음';
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
const EMPTY_ICON = '<svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true"><rect x="2" y="2" width="116" height="76" fill="none" stroke="#999" stroke-dasharray="4 4"/><path d="M45 78 L55 10 M75 78 L65 10" stroke="#999" stroke-width="3" fill="none"/><path d="M60 70 V58 M60 48 V36 M60 26 V14" stroke="#999" stroke-width="3" fill="none"/><circle cx="92" cy="26" r="11" fill="none" stroke="#999" stroke-width="3"/><path d="M100 34 L110 44" stroke="#999" stroke-width="3"/></svg>';
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

/* 서브 화면 뒤로가기 (로고는 항상 홈으로) */
const backBtn = $('#backBtn');
if (backBtn) backBtn.addEventListener('click', () => {
  if (document.referrer && history.length > 1) history.back();
  else location.href = backBtn.dataset.fallback || HOME_URL;
});

/* 헤더 우측 : 가입 전 '가입' / 가입 후 닉네임 */
const userChip = $('#userChip');
if (userChip) {
  const u = store.get(KEY.user);
  userChip.textContent = '☺';                       // 모든 화면 동일한 로그인 아이콘 (상태는 색으로만 구분)
  userChip.classList.add('hdr-ic');
  userChip.setAttribute('aria-label', u ? `${u.nickname} 마이페이지` : '가입·로그인');
  userChip.href = u ? `${BASE}my.html` : `${BASE}signup.html`;
  userChip.classList.toggle('on', !!u);
}

/* TOP 버튼 */
const topBtn = document.createElement('button');
topBtn.className = 'totop';
topBtn.setAttribute('aria-label', '맨 위로');
topBtn.textContent = '↑';
document.body.appendChild(topBtn);
addEventListener('scroll', () => topBtn.classList.toggle('show', scrollY > 400));
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

console.log('Safe Drive loaded —', document.body.dataset.page, '| state areas:', $$('.state').map(s => s.id));

/* ---------- 경로 ---------- */
const routeCard = (r, extra = '') => `<div class="card" data-href="${BASE}compare.html?origin=${encodeURIComponent(r.origin)}&destination=${encodeURIComponent(r.destination)}">
  <div><b>${esc(r.origin)} → ${esc(r.destination)}</b><p class="mu">빠른 경로 · 안전 경로 비교 ${extra}</p></div><span class="mu">›</span></div>`;
const TYPE_LABEL = { fast: '빠른 경로', safe: '안전 경로' };
const pair = (o, d) => `origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`;
const compareUrl = r => `${BASE}compare.html?${pair(r.origin, r.destination)}`;
const previewUrl = (r, type) => `${BASE}preview.html?${pair(r.origin, r.destination)}&type=${type}`;
const driveUrl = (r, type) => `${BASE}drive.html?${pair(r.origin, r.destination)}&type=${type}`;
/* 경로를 만들 수 없을 때 표준 안내 */
function failView(e, back = '../index.html') {
  const l = $('#state-loading'); if (l) l.classList.remove('on');
  const host = $('main') || document.body;
  host.insertAdjacentHTML('afterbegin', emptyState({ title: '경로를 만들 수 없어요',
    tips: [esc(e && e.message ? e.message : String(e)), '출발지와 도착지를 확인하고 다시 시도해 주세요'], actions: [{ href: back, label: '다시 입력하기' }] }));
  console.warn('[경로 실패]', e);
}
/* 사고 다발지점 요약 문구 (실제 사고 건수 합) */
const hazardSum = st => st.hazards.length ? `사고 다발지점 ${st.hazards.length}곳 · 사고 ${st.score}건` : '지나는 사고 다발지점 없음';
