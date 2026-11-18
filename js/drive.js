/* drive.js — 안내(내비) 화면: 경로 지도 · 회전 안내 · 위험 구간 알림 · 재탐색
   모드: 시뮬레이션(가상 위치) / 실제 GPS(폰 위치). 위치가 바뀔 때마다 update()가 같은 로직으로 안내한다. */
const q = qs();
const o = q.get('origin'), d = q.get('destination');
const type = q.get('type') === 'fast' ? 'fast' : 'safe';

let res, route, total = 0, xy, car = { pos: [0, 0], head: 0 };
let pos = 0, speedMult = 1, mode = 'sim', timer = null, voice = true, finished = false, view = 'follow';
let gpsId = null, off = 0, gpsSpeed = 0;
let tm = null, tileGen = 0;                          // tm: 실제 지도(타일) 상태. 지도를 못 불러오면 null 이고 약식 경로 그림(SVG)을 쓴다
const said = new Set(), hz = [];                      // hz[i].state: wait | near | done

$('#headerTitle').textContent = `${o} → ${d}`;
$('#typeBadge').textContent = TYPE_LABEL[type];

const fmtDist = m => m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.max(Math.round(m / 10) * 10, 0)}m`;
const iconOf = t => ico(/유턴/.test(t) ? 'uturn' : /좌/.test(t) ? 'left' : /우/.test(t) ? 'right' : /도착|목적/.test(t) ? 'flag' : 'straight');
const NS = 'http://www.w3.org/2000/svg';
const svg = $('#map');

function speak(text) {
  if (!voice || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; speechSynthesis.speak(u); } catch {}
}

/* ---------- 실제 지도 (OpenStreetMap 타일) ---------- */
const CAR_SVG = '<svg viewBox="-14 -18 28 34" width="28" height="34" style="transform-origin:50% 50%"><polygon points="0,-16 11,12 0,6 -11,12" fill="#2b6fff" stroke="#fff" stroke-width="2.5"/></svg>';
async function initTiles() {
  const gen = ++tileGen, box = $('.navmap');
  if (tm) { tm.map.remove(); tm = null; $('#tmap')?.remove(); box.classList.remove('tiles'); }
  const el = document.createElement('div'); el.id = 'tmap'; box.prepend(el);
  const m = await createMap(el, { center: route.path[0], zoom: 17 });
  if (!m || gen !== tileGen) { if (!m) el.remove(); return; }
  const { L, map } = m;
  const t = { L, map, view: null, hz: [] };
  L.polyline(route.path, { color: '#fff', weight: 14, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);      // 흰 테두리로 지도 위에서 경로가 또렷하게 보이게
  L.polyline(route.path, { color: '#5b8f7a', weight: 8, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  t.done = L.polyline([], { color: '#0b8457', weight: 8, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  L.circleMarker(route.path[route.path.length - 1], { radius: 8, color: '#c0282d', weight: 4, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
  route.hazards.forEach(h => t.hz.push(L.circleMarker([h.seg.lat, h.seg.lng], { radius: 9, color: '#fff', weight: 2, fillColor: RISK_COLOR[h.seg.riskLevel] || '#5b6560', fillOpacity: 1 }).addTo(map)));
  t.car = L.marker(route.path[0], { icon: L.divIcon({ className: 'carm', html: CAR_SVG, iconSize: [28, 34], iconAnchor: [14, 17] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  tm = t; box.classList.add('tiles');
  map.invalidateSize(); paint();
}
function tilePaint(cp) {
  tm.car.setLatLng(cp.pos);
  const svgEl = tm.car.getElement()?.firstChild; if (svgEl) svgEl.style.transform = `rotate(${car.head}deg)`;
  const i = route.cum.findIndex(v => v > pos), k = i < 0 ? route.path.length : i;
  tm.done.setLatLngs(route.path.slice(0, k).concat([cp.pos]));
  tm.hz.forEach((c, j) => c.setStyle({ fillOpacity: hz[j] && hz[j].state === 'done' ? .35 : 1 }));
  if (view === 'follow') tm.map.setView(cp.pos, 17, { animate: false });
  else if (tm.view !== 'all') tm.map.fitBounds(tm.L.latLngBounds(route.path), { padding: [30, 30], animate: false });
  tm.view = view;
}

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
  hz.length = 0;
  route.hazards.forEach((h, i) => {
    const p = xy([h.seg.lat, h.seg.lng]), c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('class', `hzc r${h.seg.riskLevel}`); c.setAttribute('id', 'hz' + i);
    $('#hzG').appendChild(c);
    hz.push({ h, state: 'wait' });
  });
  $('#pointList').innerHTML = hz.map((x, i) =>
    `<div class="tl-item wait" id="pt${i}"><span class="tl-n r${x.h.seg.riskLevel}">${i + 1}</span>
      <div><div class="tl-top"><b>${esc(x.h.seg.roadName)}</b></div>
        <p class="mu">출발 후 ${(x.h.at / 1000).toFixed(1)}km · 사고 ${x.h.seg.accidentCount}건 · <span class="pt-state">대기</span></p></div></div>`).join('')
    || '<p class="mu" style="padding:14px 0">이 경로에는 알려진 위험 구간이 없어요</p>';
  paint();
  initTiles();
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

  const left = Math.max(1 - pos / total, 0);
  $('#pvLeft').textContent = `${(total * left / 1000).toFixed(1)}km`;
  $('#pvEta').textContent = `${Math.round(route.minutes * left)}분`;
  $('#pvSpeed').textContent = mode === 'gps' ? `${Math.round(gpsSpeed)}km/h` : (timer ? `가상 ×${speedMult}` : '정지');
  $('#pvPassed').textContent = `${hz.filter(x => x.state === 'done').length}/${hz.length}`;

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
  /* 위험 구간 접근 · 통과 */
  hz.forEach(x => {
    const dist = x.h.at - pos, s = x.h.seg;
    if (x.state === 'wait' && dist <= CONFIG.ALERT_M && dist > -50) {
      x.state = 'near';
      $('#alertText').textContent = `${fmtDist(Math.max(dist, 0))} 앞 사고 다발지점 · ${s.roadName}`;
      $('#alertAdvice').textContent = `${isNil(s.year) ? '' : s.year + '년 기준 '}사고 ${s.accidentCount}건`;
      $('#alert').dataset.lv = s.riskLevel;
      speak(`${s.roadName}, 사고 다발지점입니다. 주의하세요.`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    if (x.state !== 'done' && dist < -50) x.state = 'done';
  });
  paint();
  if (pos >= total - 20 && !finished) finish();
}

function finish() {
  finished = true; stop();
  hz.forEach(x => { x.state = 'done'; });
  paint();
  $('#playBtn').textContent = '다시 시작';
  $('#state-done').classList.add('on');
  $('#doneText').textContent = `도착했어요! ${TYPE_LABEL[type]}로 사고 다발지점 ${hz.length}곳을 지났어요.`;
  speak('목적지에 도착했습니다. 수고하셨습니다.');
}

/* ---------- 시뮬레이션 ---------- */
function tick() { pos = Math.min(pos + (total / 60) * speedMult * 0.1, total); update(); }
function stop() { clearInterval(timer); timer = null; }
function play() {
  if (mode === 'gps') return;
  if (finished) reset();
  if (timer) { stop(); $('#playBtn').textContent = '계속'; paint(); return; }
  timer = setInterval(tick, 100);
  $('#playBtn').textContent = '일시정지';
}
function reset() {
  stop(); pos = 0; finished = false; said.clear(); off = 0;
  hz.forEach(x => { x.state = 'wait'; });
  $('#state-done').classList.remove('on'); $('#state-reroute').classList.remove('on');
  $('#playBtn').textContent = '시작';
  try { speechSynthesis.cancel(); } catch {}
  paint();
}

/* ---------- 실제 GPS ---------- */
function startGps() {
  if (!navigator.geolocation) { $('#state-gps-denied').classList.add('on'); return setMode('sim'); }
  stop(); reset(); $('#playBtn').textContent = 'GPS 추적 중';
  gpsId = navigator.geolocation.watchPosition(onFix, e => {
    if (e.code === 1) { $('#state-gps-denied').classList.add('on'); setMode('sim'); }      // 권한 거부일 때만 시뮬레이션으로 복귀
    else $('#pvSpeed').textContent = 'GPS 신호 약함';                                          // 일시적인 신호 오류는 계속 추적
  }, { enableHighAccuracy: true });
}
function stopGps() { if (gpsId !== null) navigator.geolocation.clearWatch(gpsId); gpsId = null; }

async function onFix(p) {
  const ll = [p.coords.latitude, p.coords.longitude];
  gpsSpeed = (p.coords.speed || 0) * 3.6;
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
      const nr = await liveRoutes('내 위치', d);
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
  if (m === 'gps') startGps(); else { stopGps(); reset(); }
}

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
paintVoice();
$('#viewBtn').addEventListener('click', e => {
  view = view === 'follow' ? 'all' : 'follow'; if (tm) tm.view = null;
  e.currentTarget.textContent = view === 'follow' ? '전체 보기' : '따라가기'; paint();
});
addEventListener('resize', () => { if (tm) tm.map.invalidateSize(); if (route) paint(); });

if (!o || !d) { $('main').innerHTML = emptyState({ title: '출발지와 도착지를 입력해 주세요', actions: [{ href: '../index.html', label: '홈으로' }] }); }
else { $('#state-loading').classList.add('on'); buildRoutes(o, d).then(r => { res = r; route = r[type]; $('#state-loading').classList.remove('on'); setup(); }).catch(failView); }
