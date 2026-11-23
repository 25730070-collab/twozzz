/* drive.js — 안내(내비) 화면: 경로 지도 · 회전 안내 · 위험 구간 알림 · 재탐색
   모드: 연습(가상 위치, 경로 길이와 상관없이 약 1분에 훑어 보기 → 음성 없음) / 실제 GPS(폰 위치 → 음성 안내).
   위치가 바뀔 때마다 update()가 같은 로직으로 안내한다. */
const q = qs();
const o = q.get('origin'), d = q.get('destination');
const type = q.get('type') === 'fast' ? 'fast' : 'safe';

let res, route, total = 0, xy, car = { pos: [0, 0], head: 0 };
let pos = 0, speedMult = 1, mode = 'sim', timer = null, voice = true, finished = false, view = 'follow', headUp = true;
let gpsId = null, off = 0, gpsSpeed = null, gpsWeak = false;     // gpsSpeed: km/h, 기기가 속도를 주지 않으면 null
let cams = null, camList = [], t0 = Date.now();                    // cams: 공공데이터 단속 카메라 전체(없으면 null) · camList: 그중 이 경로 위의 것 · t0: 연습 주행의 가상 출발 시각
let tm = null, tileGen = 0;                          // tm: 실제 지도(타일) 상태. 지도를 못 불러오면 null 이고 약식 경로 그림(SVG)을 쓴다
const said = new Set(), hz = [];                      // hz[i].state: wait | near | done

$('#headerTitle').textContent = `${o} → ${d}`;
$('#typeBadge').textContent = TYPE_LABEL[type];

const fmtDist = m => m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.max(Math.round(m / 10) * 10, 0)}m`;
const iconOf = t => ico(/유턴/.test(t) ? 'uturn' : /좌/.test(t) ? 'left' : /우/.test(t) ? 'right' : /도착|목적/.test(t) ? 'flag' : 'straight');
const NS = 'http://www.w3.org/2000/svg';
const svg = $('#map');

function speak(text) {
  if (mode !== 'gps' || !voice || !('speechSynthesis' in window)) return;   // 연습은 속도·길이가 실제와 달라 말과 화면이 어긋나므로 음성은 실제 GPS에서만
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; speechSynthesis.speak(u); } catch {}
}

/* ---------- 실제 지도 (OpenStreetMap 타일) ----------
   '진행 방향이 위'(headUp): 실제 내비처럼 차는 늘 화면 아래쪽에서 위를 보고, 지도는 차 방향에 맞춰 돌면서 뒤로 눕는다(3D 시점).
   · 화면보다 큰 정사각형 지도(#tmap)를 통째로 돌리고(rotateZ) 눕혀서(rotateX + perspective) 앞길이 멀리 이어져 보이게 한다.
   · 차 아이콘은 지도 위가 아니라 화면에 고정된 그림(#carFix)이라 지도가 기울어도 찌그러지지 않는다.
   · 멀리(화면 위쪽)는 안개처럼 흐리게 덮는다. 타일은 가까운 곳만 불러오므로 불러오는 개수가 크게 늘지 않는다.
   전체 보기·다발지점 보기·북쪽 고정은 눕히지 않은 북쪽이 위인 지도다. 나침반 버튼으로 오간다. */
const CAR_SVG = '<svg viewBox="-14 -18 28 34" width="28" height="34" style="transform-origin:50% 50%"><polygon points="0,-16 11,12 0,6 -11,12" fill="#2b6fff" stroke="#fff" stroke-width="2.5"/></svg>';
const PITCH = 45, PERSP = 700;                                // 눕힌 각도(°)와 원근 거리(px). 각도가 클수록 더 눕고 멀리 보인다
const ANCHOR = 0.68;                                          // 차가 놓이는 세로 위치 (0=맨 위, 1=맨 아래) — 앞길을 많이 보여 주려고 아래쪽
const FADE = 0.30;                                            // (안개 높이는 css .navmap.tilt::after 와 맞춘다. 지도는 이제 화면 맨 위까지 덮는다)
const spin = () => view === 'follow' && headUp;                // 지도를 돌리고 눕히는 상태
const wrap = x => ((x % 360) + 540) % 360 - 180;               // 각도 차이를 -180~180 으로: 350°→10° 가 340° 를 거꾸로 돌지 않고 20° 만 돈다

/* 눕힌 지도에서: 화면의 한 점(차 위치 기준 dx,dy px) → 지도 위의 거리(px). 원근 투영을 거꾸로 푼 것 */
function planeOf(dx, dy) {
  const th = PITCH * Math.PI / 180, den = PERSP * Math.cos(th) + dy * Math.sin(th);
  const y = dy * PERSP / den, k = PERSP / (PERSP - y * Math.sin(th));
  return [dx / k, y];
}

function layoutTiles() {
  const box = $('.navmap'), el = $('#tmap'); if (!box || !el) return;
  const w = box.clientWidth, h = box.clientHeight;
  box.style.setProperty('--anchor', ANCHOR);                                 // 화면에 고정된 차 그림(.carfix)의 세로 위치
  if (!spin() || !w || !h) { el.classList.remove('rot'); ['width', 'height', 'left', 'top', 'transform'].forEach(k => { el.style[k] = ''; }); return; }
  const cx = w / 2, cy = h * ANCHOR, top = 0;                              // 화면 맨 위까지 지도가 빈틈없이 덮이게 (예전에는 안개 아래까지만 덮어서 위쪽에 지도 끝선이 보였다)
  let R = 0;                                                              // 차에서 '안개 아래 보이는 화면' 네 모서리까지 지도 위 거리 중 가장 먼 것
  for (const [sx, sy] of [[0, top], [w, top], [0, h], [w, h]]) { const [px, py] = planeOf(sx - cx, sy - cy); R = Math.max(R, Math.hypot(px, py)); }
  const D = Math.min(Math.ceil(2 * R) + 8, 2400);                         // 어느 방향으로 돌려도 그 범위가 덮이는 정사각형 크기
  el.classList.add('rot');
  Object.assign(el.style, { width: D + 'px', height: D + 'px', left: (cx - D / 2) + 'px', top: (cy - D / 2) + 'px' });
}

/* 크기·회전을 맞춘다. 눕히는 상태가 바뀔 때는 애니메이션 없이 한 번에 */
function syncTiles() {
  const sp = spin(), snap = sp !== tm.sp, ic = tm.car.getElement()?.firstChild, el = $('#tmap'), cp = $('#compassBtn'), box = $('.navmap');
  tm.hd += wrap(car.head - tm.hd);                                       // 차 방향 (연속된 각도로 이어 가며 값만 갱신)
  if (snap) {
    tm.sp = sp; tm.rot = sp ? tm.hd : 0;
    box.classList.toggle('tilt', sp);
    layoutTiles(); tm.map.invalidateSize({ animate: false });
    ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom'].forEach(k => { const hd = tm.map[k]; if (hd) hd[sp ? 'disable' : 'enable'](); });   // 눕힌 지도는 손으로 옮기거나 확대하지 않는다
    tm.casing.setStyle({ weight: sp ? 21 : 14 }); tm.base.setStyle({ weight: sp ? 14 : 8 });                                                     // 눕히면 멀리 있는 선이 가늘어 보이므로 더 굵게
  } else tm.rot += wrap((sp ? tm.hd : 0) - tm.rot);
  const nodes = [el, ic, cp && cp.firstElementChild].filter(Boolean);
  if (snap) nodes.forEach(n => { n.style.transition = 'none'; });
  if (ic) ic.style.transform = `rotate(${tm.hd}deg)`;                    // (눕히지 않았을 때) 지도 위 차 아이콘은 차 방향으로
  if (el && sp) el.style.transform = `perspective(${PERSP}px) rotateX(${PITCH}deg) rotateZ(${-tm.rot}deg)`;
  if (cp) { cp.hidden = view !== 'follow'; cp.firstElementChild.style.transform = `rotate(${-tm.rot}deg)`; }
  if (snap) { void el?.offsetWidth; nodes.forEach(n => { n.style.transition = ''; }); }
}

async function initTiles() {
  const gen = ++tileGen, box = $('.navmap');
  if (tm) { tm.map.remove(); tm = null; $('#tmap')?.remove(); box.classList.remove('tiles', 'tilt'); }
  const el = document.createElement('div'); el.id = 'tmap'; box.prepend(el);
  layoutTiles();                                                          // 지도를 만들기 전에 크기를 정해 둔다 (Leaflet 은 만들 때 크기를 잰다)
  const m = await createMap(el, { center: route.path[0], zoom: 17 });
  if (!m || gen !== tileGen) { if (!m) el.remove(); return; }
  const { L, map } = m;
  const t = { L, map, view: null, hz: [], sp: null, hd: 0, rot: 0 };
  t.casing = L.polyline(route.path, { color: '#fff', weight: 14, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);      // 흰 테두리로 지도 위에서 경로가 또렷하게 보이게
  t.base = L.polyline(route.path, { color: '#0b8457', weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);        // 앞으로 갈 길: 진한 초록
  t.done = L.polyline([], { color: '#a9b4ae', weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);                // 지나온 길: 옅은 회색 (base 와 같은 굵기로 위에 덮는다)
  L.circleMarker(route.path[route.path.length - 1], { radius: 8, color: '#c0282d', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  route.hazards.forEach(h => t.hz.push(L.circleMarker([h.seg.lat, h.seg.lng], { radius: 9, color: '#fff', weight: 2, fillColor: RISK_COLOR[h.seg.riskLevel] || '#5b6560', fillOpacity: 1 }).addTo(map)));
  t.cams = camList.map(c => L.circleMarker([c.cam.lat, c.cam.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#d6322f', fillOpacity: 1 }).addTo(map));   // 이 길 위의 단속 카메라
  t.car = L.marker(route.path[0], { icon: L.divIcon({ className: 'carm', html: CAR_SVG, iconSize: [28, 34], iconAnchor: [14, 17] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  tm = t; box.classList.add('tiles');
  map.invalidateSize(); paint();
}
function tilePaint(cp) {
  syncTiles();
  tm.car.setLatLng(cp.pos);
  const i = route.cum.findIndex(v => v > pos), k = i < 0 ? route.path.length : i;
  tm.done.setLatLngs(route.path.slice(0, k).concat([cp.pos]));
  tm.done.setStyle({ weight: spin() ? 14 : 8 });
  tm.hz.forEach((c, j) => c.setStyle({ fillOpacity: hz[j] && hz[j].state === 'done' ? .35 : 1 }));
  if (view === 'follow') tm.map.setView(cp.pos, 17, { animate: false });
  else if (view === 'all' && tm.view !== 'all') tm.map.fitBounds(tm.L.latLngBounds(route.path), { padding: [30, 30], animate: false });
  tm.view = view;
}

/* ---------- 화면 꺼짐 방지 (주행 중 화면이 꺼지면 안내가 멈춘 것처럼 보이므로) ---------- */
let wake = null;
async function keepAwake(on) {
  try {
    if (!on) { const w = wake; wake = null; await w?.release(); return; }
    if (!('wakeLock' in navigator) || wake) return;
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch { wake = null; }                                                 // 지원하지 않거나 거부되면 조용히 넘어간다
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (mode === 'gps' || timer) && !finished) keepAwake(true); });

/* ---------- 준비 ---------- */
function setup() {
  total = route.cum[route.cum.length - 1];
  const to = toXY(route.path[0][0], route.path[0][1]);
  xy = p => to(p);
  const pts = route.path.map(xy);
  const dstr = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
  svg.innerHTML = `
    <path id="pathAll" d="${dstr}" fill="none" stroke="#bdbdb5" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path id="pathDone" d="${dstr}" fill="none" stroke="#161616" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0 1e9"/>
    <g id="hzG"></g>
    <circle id="endPt" r="1" fill="#fff" stroke="#161616" stroke-width="3"/>
    <g id="carG"><polygon points="0,-16 11,12 0,6 -11,12" fill="#2b6fff" stroke="#fff" stroke-width="2"/></g>`;
  const end = pts[pts.length - 1];
  $('#endPt').setAttribute('cx', end[0]); $('#endPt').setAttribute('cy', end[1]);
  camList = cams ? camsOnRoute(route, cams, CONFIG.CAMERA_RADIUS_M) : [];
  $('#tbHz').innerHTML = route.hazards.map(h => `<i style="background:${RISK_COLOR[h.seg.riskLevel] || '#5b6560'}"></i>`).join('');
  hz.length = 0;
  route.hazards.forEach((h, i) => {
    const p = xy([h.seg.lat, h.seg.lng]), c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('class', `hzc r${h.seg.riskLevel}`); c.setAttribute('id', 'hz' + i);
    $('#hzG').appendChild(c);
    hz.push({ h, state: 'wait' });
  });
  $('#pointList').innerHTML = hz.map((x, i) =>
    `<div class="tl-item wait" id="pt${i}" data-i="${i}"><span class="tl-n r${x.h.seg.riskLevel}">${i + 1}</span>
      <div><div class="tl-top"><b>${esc(x.h.seg.roadName)}</b></div>
        <p class="mu">출발 후 ${(x.h.at / 1000).toFixed(1)}km · 사고 ${x.h.seg.accidentCount}건 · <span class="pt-state">대기</span></p>${pntBrief(x.h.seg) ? `<p class="mu">${esc(pntBrief(x.h.seg))}</p>` : ''}</div></div>`).join('')
    || '<p class="mu" style="padding:14px 0">이 경로에는 알려진 위험 구간이 없어요</p>';
  paint(); paintNote();
  initTiles();
}

/* ---------- 아래 안내 패널 · 교통 막대 · 제한속도 표지 ---------- */
let curLimit = null;                                    // 지금 보이는 표지의 제한속도(없으면 null)
function paintInfo() {
  const m = Math.min(pos, total), left = Math.max(total - m, 0), sec = remainSec(route, m);
  /* 도착 시각: 실제 GPS 는 '지금 + 남은 시간', 연습은 가상 주행이라 '지금 출발했다면'으로 고정 */
  const eta = mode === 'gps' ? Date.now() + sec * 1000 : t0 + (route.dur || route.minutes * 60) * 1000;
  $('#npTime').textContent = fmtDur(sec);
  $('#npSub').textContent = `${fmtDist(left)} · ${fmtClock(eta)} 도착`;

  /* 제한속도 표지 : 이 길 위의 단속 카메라가 가까워졌을 때만 */
  const nc = nextCam(camList, pos, CONFIG.CAMERA_ALERT_M), sign = $('#limitSign');
  curLimit = nc ? nc.cam.limit : null;
  sign.hidden = !nc;
  if (nc) {
    $('#limitNum').textContent = nc.cam.limit === null ? '단속' : nc.cam.limit;
    $('#limitNum').classList.toggle('nolimit', nc.cam.limit === null);
    $('#limitDist').textContent = fmtDist(Math.max(nc.at - pos, 0));
    sign.setAttribute('aria-label', `${fmtDist(Math.max(nc.at - pos, 0))} 앞 단속 카메라${nc.cam.limit === null ? '' : ', 제한속도 ' + nc.cam.limit + '킬로미터'}`);
  }

  /* 속도 : 실제 GPS 에서만 숫자. 연습은 속도를 지어내지 않는다 */
  const sp = $('#npSpd'), lv = mode === 'gps' && !gpsWeak ? speedLevel(gpsSpeed, curLimit) : 'none';
  $('#npSpeed').textContent = mode === 'gps' ? (gpsWeak || gpsSpeed === null ? '-' : Math.round(gpsSpeed)) : (timer ? '×' + speedMult : '-');
  $('#npUnit').textContent = mode === 'gps' ? (gpsWeak ? '신호 약함' : 'km/h') : '연습';
  sp.classList.toggle('near', lv === 'near'); sp.classList.toggle('over', lv === 'over');

  /* 교통 막대 : 지금 위치(아래) → 도착(위). 길찾기 때 받은 도로별 교통 상태를 이어서 칠한다 */
  const bar = $('#tbar'); bar.hidden = !hasTraffic(route);
  if (!bar.hidden) {
    const stops = [];
    for (const g of trafficSegs(route)) {
      const a = Math.max(g.from, m), b = g.to; if (b <= a || left <= 0) continue;
      stops.push(`${trafficOf(g.st)?.color || '#cfd6d2'} ${((a - m) / left * 100).toFixed(2)}% ${((b - m) / left * 100).toFixed(2)}%`);
    }
    bar.style.background = stops.length ? `linear-gradient(to top, ${stops.join(',')})` : '#cfd6d2';
    [...$('#tbHz').children].forEach((el, i) => {
      const at = route.hazards[i].at, pct = left > 0 ? (at - m) / left * 100 : 0;
      el.style.display = pct < -2 ? 'none' : ''; el.style.bottom = Math.min(Math.max(pct, 0), 100) + '%';
      el.classList.toggle('done', hz[i] && hz[i].state === 'done');
    });
  }
}
function paintNote() {
  if (!route) return;
  const t = ['남은 시간·도착 시각은 길찾기를 요청한 때의 교통 정보(카카오모빌리티) 기준 예상이에요. 실시간으로 바뀌지는 않아요.'];
  t.push(hasTraffic(route) ? '왼쪽 막대는 앞으로 갈 길의 교통 상황이에요 (초록 원활 · 노랑 서행 · 주황 지체 · 빨강 정체).' : '이 경로는 교통 상황 정보가 없어 막대를 보여 주지 않아요.');
  t.push(cams ? '제한속도 표지는 공공데이터의 단속 카메라 위치에서만 나와요. 모든 도로의 제한속도는 아니고, 반대 방향 카메라가 함께 보일 수 있어요.' : '단속 카메라·제한속도 데이터 파일이 없어 제한속도는 표시하지 않아요.');
  if (mode !== 'gps') t.push('연습에서는 도착 시각을 지금 출발한다고 가정해 보여 줘요.');
  $('#infoNote').textContent = t.join(' ');
}

/* ---------- 화면 갱신 ---------- */
function paint() {
  const cp = pointAt(route.path, route.cum, pos);
  const ahead = pointAt(route.path, route.cum, pos + 40).pos;
  if (hav(cp.pos, ahead) > 3) car.head = bearing(cp.pos, ahead);
  car.pos = cp.pos;
  const c = xy(cp.pos);

  if (tm) tilePaint(cp);
  else {
    const w = svg.clientWidth || 390, h = svg.clientHeight || 300;
    let vb;
    if (view === 'follow') { const W = 1300, H = W * h / w; vb = [c[0] - W / 2, c[1] - H / 2, W, H]; }
    else {
      const all = route.path.map(xy), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      let W = (maxX - minX) * 1.2 || 600, H = (maxY - minY) * 1.2 || 600;
      if (W / H < w / h) W = H * w / h; else H = W * h / w;
      vb = [(minX + maxX) / 2 - W / 2, (minY + maxY) / 2 - H / 2, W, H];
    }
    svg.setAttribute('viewBox', vb.join(' '));
    const k = vb[2] / w;
    $('#carG').setAttribute('transform', `translate(${c[0]} ${c[1]}) rotate(${car.head}) scale(${k * 1.1})`);
    $('#pathDone').setAttribute('stroke-dasharray', `${pos} 1e9`);
    $$('.hzc').forEach(e => e.setAttribute('r', 8 * k));
    $('#endPt').setAttribute('r', 7 * k);
  }

  /* 다음 회전 안내 */
  const g = route.guides.find((x, i) => i > 0 && x.at > pos + 15);
  if (g) { $('#turnIc').innerHTML = iconOf(g.text); $('#turnText').textContent = g.text; $('#turnDist').textContent = `${fmtDist(g.at - pos)} 앞`; }
  else { $('#turnIc').innerHTML = ico('flag'); $('#turnText').textContent = '목적지 근처예요'; $('#turnDist').textContent = fmtDist(total - pos); }

  paintInfo();
  $('#pvPassed').textContent = `${hz.filter(x => x.state === 'done').length}/${hz.length}`;
  $('#pvMode').textContent = mode === 'gps' ? 'GPS 추적' : (timer ? `연습 ×${speedMult}` : '정지');

  hz.forEach((x, i) => {
    const hzEl = $('#hz' + i); if (hzEl) hzEl.classList.toggle('done', x.state === 'done');
    const li = $('#pt' + i); li.className = 'tl-item ' + x.state;
    $('.pt-state', li).textContent = { wait: '대기', near: '접근 중', done: '통과' }[x.state];
  });
  $('#alert').classList.toggle('on', hz.some(x => x.state === 'near'));
}

/* ---------- 안내 로직 (위치가 갱신될 때마다) ---------- */
function update() {
  /* 회전 안내 음성 */
  route.guides.forEach((g, i) => {
    if (i > 0 && !said.has('g' + i) && g.at - pos <= CONFIG.TURN_ANNOUNCE_M && g.at > pos) {
      said.add('g' + i);
      speak(`${Math.round((g.at - pos) / 50) * 50}미터 앞, ${g.text}`);
    }
  });
  /* 단속 카메라 접근 (음성은 실제 GPS 에서만) */
  camList.forEach((c, i) => {
    if (!said.has('c' + i) && c.at > pos && c.at - pos <= CONFIG.CAMERA_ALERT_M) {
      said.add('c' + i);
      speak(`${Math.round((c.at - pos) / 50) * 50}미터 앞 단속 카메라${c.cam.limit === null ? '입니다' : `, 제한속도 ${c.cam.limit}킬로미터입니다`}`);
    }
  });
  /* 위험 구간 접근 · 통과 */
  hz.forEach(x => {
    const dist = x.h.at - pos, s = x.h.seg;
    if (x.state === 'wait' && dist <= CONFIG.ALERT_M && dist > -50) {
      x.state = 'near';
      $('#alertText').textContent = `${fmtDist(Math.max(dist, 0))} 앞 사고 다발지점 · ${s.roadName}`;
      const tip = pntAdvice(s);                                    // 가장 많은 사고 유형에 맞춘 주의 안내 (없으면 생략)
      $('#alertAdvice').textContent = `${isNil(s.year) ? '' : s.year + '년 기준 '}사고 ${s.accidentCount}건${tip ? ' · ' + tip : ''}`;
      $('#alert').dataset.lv = s.riskLevel;
      speak(`${s.roadName}, 사고 다발지점입니다. ${tip || '주의하세요'}.`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    if (x.state !== 'done' && dist < -50) x.state = 'done';
  });
  paint();
  if (pos >= total - 20 && !finished) finish();
}

function finish() {
  finished = true; stop(); keepAwake(false);
  hz.forEach(x => { x.state = 'done'; });
  paint();
  $('#playBtn').textContent = '다시 시작';
  $('#state-done').classList.add('on');
  $('#doneText').textContent = `도착했어요! ${TYPE_LABEL[type]}로 사고 다발지점 ${hz.length}곳을 지났어요.`;
  speak('목적지에 도착했습니다. 수고하셨습니다.');
}

/* ---------- 시뮬레이션 ---------- */
function tick() { pos = Math.min(pos + (total / 60) * speedMult * 0.1, total); update(); }
function stop() { clearInterval(timer); timer = null; if (mode !== 'gps') keepAwake(false); }
function play() {
  if (mode === 'gps') return;
  if (finished) reset();
  if (timer) { stop(); $('#playBtn').textContent = '계속'; paint(); return; }
  timer = setInterval(tick, 100); keepAwake(true);
  $('#playBtn').textContent = '일시정지';
}
function reset() {
  stop(); pos = 0; finished = false; said.clear(); off = 0; t0 = Date.now();
  hz.forEach(x => { x.state = 'wait'; });
  $('#state-done').classList.remove('on'); $('#state-reroute').classList.remove('on');
  $('#playBtn').textContent = '시작';
  try { speechSynthesis.cancel(); } catch {}
  paint();
}

/* ---------- 실제 GPS ---------- */
function startGps() {
  if (!navigator.geolocation) { $('#state-gps-denied').classList.add('on'); return setMode('sim'); }
  gpsSpeed = null; gpsWeak = false;
  stop(); reset(); $('#playBtn').textContent = 'GPS 추적 중'; keepAwake(true);
  gpsId = navigator.geolocation.watchPosition(onFix, e => {
    if (e.code === 1) { $('#state-gps-denied').classList.add('on'); setMode('sim'); }      // 권한 거부일 때만 시뮬레이션으로 복귀
    else { gpsWeak = true; if (route) paint(); }                                              // 일시적인 신호 오류는 계속 추적 (패널의 속도 자리에 '신호 약함')
  }, { enableHighAccuracy: true });
}
function stopGps() { if (gpsId !== null) navigator.geolocation.clearWatch(gpsId); gpsId = null; keepAwake(false); }

async function onFix(p) {
  const ll = [p.coords.latitude, p.coords.longitude];
  gpsWeak = false;
  gpsSpeed = typeof p.coords.speed === 'number' && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null;   // 기기가 속도를 주지 않으면 0 으로 꾸미지 않고 '-'
  const snap = nearestOnPath(route.path, route.cum, ll);
  if (snap.dist > CONFIG.OFFROUTE_M) {
    if (++off >= CONFIG.OFFROUTE_COUNT) { off = 0; return reroute(); }
    paint(); return;
  }
  off = 0; pos = Math.max(pos, snap.along);
  if (p.coords.heading != null && !isNaN(p.coords.heading)) car.head = p.coords.heading;
  update();
}

let rerouting = false;
async function reroute() {
  if (rerouting) return;
  rerouting = true;
  $('#state-reroute').classList.add('on');
  $('#rerouteText').textContent = '경로를 벗어났어요. 새 경로를 찾는 중…';
  speak('경로를 이탈했습니다.');
  {
    try {
      const nr = await liveRoutes('내 위치', d, null, { detours: type === 'safe' });   // 빠른 경로 안내 중이면 우회 탐색 없이 바로
      route = nr[type]; res = nr; pos = 0; said.clear(); setup();
      $('#rerouteText').textContent = '새 경로로 안내를 이어가요';
      speak('새 경로로 안내합니다.');
    } catch (e) { $('#rerouteText').textContent = '재탐색에 실패했어요: ' + e.message; }
  }
  setTimeout(() => { $('#state-reroute').classList.remove('on'); rerouting = false; }, 2500);
}

function setMode(m) {
  mode = m;
  $$('#modeBox [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#speedBox').hidden = m === 'gps';
  $('#voiceBtn').hidden = m !== 'gps'; $('#simNote').hidden = m === 'gps';   // 음성 버튼은 실제 GPS에서만 보인다
  if (m === 'gps') startGps(); else { stopGps(); reset(); }
  paintNote();
}

/* 다발지점을 누르면 지도에서 그 위치를 보여 준다 (지도를 못 불러온 경우엔 상세 화면으로) */
$('#pointList').addEventListener('click', e => {
  const it = e.target.closest('[data-i]'); if (!it) return;
  const h = hz[Number(it.dataset.i)]; if (!h) return;
  if (!tm) return void (location.href = segUrl(h.h.seg.segmentId));
  view = 'free'; tm.view = 'free'; syncTiles();                    // 회전을 풀고(북쪽이 위) 그 지점으로 이동
  tm.map.setView([h.h.seg.lat, h.h.seg.lng], 17, { animate: false });
  tm.hz.forEach((c, j) => c.setStyle(j === Number(it.dataset.i) ? { color: '#161616', weight: 4 } : { color: '#fff', weight: 2 }));
  $('#viewBtn').textContent = '따라가기';
  $('.navmap').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  toast(`${h.h.seg.roadName}${pntBrief(h.h.seg) ? ' · ' + pntBrief(h.h.seg) : ''}`);
});

/* ---------- 이벤트 ---------- */
$('#playBtn').addEventListener('click', play);
$('#resetBtn').addEventListener('click', reset);
$('#modeBox').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) { $('#state-gps-denied').classList.remove('on'); setMode(b.dataset.mode); } });
$('#speedBox').addEventListener('click', e => {
  const b = e.target.closest('[data-speed]'); if (!b) return;
  speedMult = Number(b.dataset.speed);
  $$('#speedBox .chip').forEach(c => c.classList.toggle('on', c === b));
});
const paintVoice = () => { const b = $('#voiceBtn'); b.innerHTML = `${ico(voice ? 'volume' : 'mute', 's')}${voice ? '음성 안내 켬' : '음성 안내 끔'}`; b.classList.toggle('on', voice); };
$('#voiceBtn').addEventListener('click', () => {
  voice = !voice; paintVoice();
  if (!voice) try { speechSynthesis.cancel(); } catch {}
});
paintVoice(); $('#voiceBtn').hidden = true;     // 처음은 연습 모드
$('#viewBtn').addEventListener('click', e => {
  view = view === 'follow' ? 'all' : 'follow'; if (tm) { tm.view = null; tm.hz.forEach(c => c.setStyle({ color: '#fff', weight: 2 })); }
  e.currentTarget.textContent = view === 'follow' ? '전체 보기' : '따라가기'; paint();
});
$('#compassBtn').addEventListener('click', () => {
  headUp = !headUp;
  const b = $('#compassBtn');
  b.setAttribute('aria-pressed', String(headUp));
  b.setAttribute('aria-label', headUp ? '지도 방향: 진행 방향이 위예요. 누르면 북쪽을 위로 고정해요' : '지도 방향: 북쪽이 위예요. 누르면 진행 방향을 위로 돌려요');
  toast(headUp ? '진행 방향이 위로 가요' : '북쪽이 위로 고정돼요');
  if (route) paint();
});
addEventListener('resize', () => { if (tm) { layoutTiles(); tm.map.invalidateSize(); } if (route) paint(); });

if (!o || !d) { $('main').innerHTML = emptyState({ title: '출발지와 도착지를 입력해 주세요', actions: [{ href: '../index.html', label: '홈으로' }] }); }
else {
  $('#state-loading').classList.add('on');
  Promise.all([buildRoutes(o, d), loadCams('../data/')]).then(([r, c]) => { res = r; cams = c; route = r[type]; $('#state-loading').classList.remove('on'); setup(); }).catch(failView);
}
