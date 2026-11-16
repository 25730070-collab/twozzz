/* common.js — 선택자 · 경로/위험 계산 · 렌더 헬퍼 · 카드 이동 · 뒤로가기 · 가입 칩 · TOP 버튼 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const BASE = document.body.dataset.base || '';                       // index.html: 'pages/', pages/*.html: ''
const HOME_URL = document.body.dataset.page === 'home' ? 'index.html' : '../index.html';
const TYPE_LABEL = { fast: '빠른 경로', safe: '안전 경로' };
const WEIGHT = { 1: 1, 2: 2, 3: 4, 4: 8 };                           // 위험등급별 점수 가중치

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = () => new URLSearchParams(location.search);
const guOf = s => s.address.split(' ')[1];
const segById = id => SEGMENTS.find(s => s.segmentId === id);

/* ---------- 주소 ---------- */
const pair = (o, d) => `origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`;
const compareUrl = r => `${BASE}compare.html?${pair(r.origin, r.destination)}`;
const previewUrl = (r, type) => `${BASE}preview.html?${pair(r.origin, r.destination)}&type=${type}`;
const driveUrl = (r, type) => `${BASE}drive.html?${pair(r.origin, r.destination)}&type=${type}`;
const segUrl = id => `${BASE}detail.html?seg=${encodeURIComponent(id)}`;

/* ---------- 경로 · 위험 계산 (JSON 연결 전 샘플 규칙) ---------- */
/* 입력한 출발·도착에 맞는 경로 찾기. 없으면 입력값으로 샘플 경로를 고른다. */
function resolveRoute(origin, destination) {
  const exact = ROUTES.find(r => r.origin === origin && r.destination === destination);
  if (exact) return { route: exact, matched: true };
  const h = [...(origin + destination)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return { route: ROUTES[h % ROUTES.length], matched: false };
}

/* 안전 경로 : 4등급 구간과 3등급 구간 절반을 피해 우회한 경로로 가정 */
function safeSegmentIds(route) {
  return route.segmentIds.filter((id, i) => {
    const lv = segById(id).riskLevel;
    return lv <= 2 || (lv === 3 && i % 2 === 1);
  });
}

function routeStats(route, type) {
  const ids = type === 'safe' ? safeSegmentIds(route) : route.segmentIds;
  const skipped = route.segmentIds.length - ids.length;
  const segs = ids.map(segById);
  return {
    type, ids, segs,
    minutes: route.fastMin + (type === 'safe' && skipped ? 2 + skipped : 0),
    km: +(route.fastKm + (type === 'safe' ? skipped * 0.5 : 0)).toFixed(1),
    high: segs.filter(s => s.riskLevel >= 3).length,
    score: segs.reduce((a, s) => a + WEIGHT[s.riskLevel], 0)
  };
}

/* 구간별 대처법 : text(화면용) · speak(음성용) */
function adviceOf(s) {
  const base = {
    '대로': '차로 변경은 교차로 100m 전에 미리 하고, 앞차와 간격을 넓히세요.',
    '이면도로': '시속 30km 이하로 서행하고, 주정차 차량 사이 보행자를 살피세요.',
    '골목길': '코너에서는 한 번 멈춰 확인하고, 아주 천천히 지나가세요.'
  }[s.roadType];
  const extra = s.riskLevel >= 4 ? ' 사고가 특히 많은 곳이니 미리 감속하세요.'
              : s.riskLevel === 3 ? ' 좌·우회전 시 직진 차량과 보행자를 한 번 더 확인하세요.' : '';
  return { text: base + extra, speak: base.split(',')[0].replace(/\.$/, '') + '.' + (s.riskLevel >= 3 ? ' 미리 감속하세요.' : '') };
}

/* ---------- 렌더 헬퍼 ---------- */
const levelBadge = n => `<span class="bg r${n} riskLevel" data-risk="${n}">${n}등급</span>`;

function segCard(s) {
  return `<div class="card" data-href="${segUrl(s.segmentId)}" data-segment-id="${s.segmentId}">
    <div><b class="roadName">${esc(s.roadName)}</b>
      <p class="mu"><span class="roadType">${s.roadType}</span> · 사고 <span class="accidentCount">${s.accidentCount}</span>건 · ${guOf(s)}</p></div>
    ${levelBadge(s.riskLevel)}</div>`;
}

/* 경로 카드 : 눌러서 빠른 경로 vs 안전 경로 비교 (즐겨찾기·최근검색·추천 코스 공통) */
function routeCard(r, extra = '') {
  return `<div class="card" data-href="${compareUrl(r)}">
    <div><b>${esc(r.origin)} → ${esc(r.destination)}</b>
      <p class="mu">빠른 경로 vs 안전 경로 비교하기 ${extra}</p></div><span class="mu">›</span></div>`;
}

const learnCard = l => `<div class="learn"><b>${l.t}</b><ol>${l.steps.map(x => `<li>${x}</li>`).join('')}</ol></div>`;
const tipCard = t => `<div class="tip"><b>${t.t}</b><p class="mu">${t.d}</p></div>`;

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
  userChip.textContent = u ? u.nickname : '가입';
  userChip.href = u ? `${BASE}my.html` : `${BASE}signup.html`;
  userChip.classList.toggle('on', !!u);
}

/* TOP 버튼 */
const topBtn = document.createElement('button');
topBtn.className = 'totop';
topBtn.setAttribute('aria-label', '맨 위로');
topBtn.innerHTML = '↑<br>TOP';
document.body.appendChild(topBtn);
addEventListener('scroll', () => topBtn.classList.toggle('show', scrollY > 400));
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

console.log('Safe Drive loaded —', document.body.dataset.page, '| state areas:', $$('.state').map(s => s.id));
