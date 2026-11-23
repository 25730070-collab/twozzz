/* e2e.mjs — Safe Drive 자동 점검. 실행: npm test  (설명은 tests/README.md)
   카카오 길찾기·장소 검색과 Leaflet 은 가짜로 대신한다. 키는 필요 없다. */
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(ROOT, 'tests', 'fixtures');
/* ---------- 시험 기준 데이터: 저장소의 실제 data/*.json 을 읽어 기대값을 계산한다 (데이터를 새로 받아도 시험이 깨지지 않게) ---------- */
const DJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'segments_static.json'), 'utf8')), DA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'segments_api.json'), 'utf8'));
const DALL = [...DJ, ...DA], LATEST = Math.max(...DALL.map(r => r.year)), N_LATEST = DALL.filter(r => r.year === LATEST).length;
const TS = DJ.find(r => r.year === LATEST) || DALL.find(r => r.year === LATEST), TSID = TS.segmentId;      // 구간 상세 시험에 쓰는 구간 (최신 연도)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* ---------- 정적 서버 ---------- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const B = `http://127.0.0.1:${server.address().port}/`;

/* ---------- 가짜 카카오 ---------- */
const PLACES = {
  '강남역': [127.0276, 37.4979], '서울역': [126.9707, 37.5547],
  'A점': [126.972638, 37.556130], 'B점': [127.042709, 37.663927],                       // 두 점을 잇는 직선이 사고 다발지점 13곳을 지난다 (data/ 기준)
  '강남역 2호선': [127.0276, 37.4979], '강남역 신분당선': [127.0282, 37.4968], '강남구청': [127.0473, 37.5172], '서울역 1호선': [126.9722, 37.5559]
};
const hv = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
const lerp = (a, b, n) => { const v = []; for (let i = 0; i <= n; i++) v.push(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); return v; };

const ALL_LOGS = [];
async function mkContext(browser, { stub = false, width = 393, keyOk = true, dirStatus = 200, geo = true, pnt = true, traffic = true, cams = null } = {}) {   // traffic: 길찾기 응답에 도로별 교통 정보를 넣을지 · cams: 단속 카메라 목록(없으면 파일 없음 404)
  const ctx = await browser.newContext({ viewport: { width, height: 852 }, ...(geo ? { permissions: ['geolocation'], geolocation: { latitude: 37.5547, longitude: 126.9707 } } : {}) });
  const log = { local: [], dir: [], errs: [] }; ALL_LOGS.push(log);
  await ctx.route('**/js/config.local.js', r => r.fulfill({ contentType: 'text/javascript', body: keyOk ? "CONFIG.KAKAO_REST_KEY = 'TEST_KEY_NOT_REAL';" : '' }));
  await ctx.route('**/data/pntfr_points.json', r => pnt ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(JSON.parse(fs.readFileSync(path.join(FX, 'pntfr_points.json'), 'utf8')).map(x => ({ ...x, lat: TS.lat + 0.0003, lng: TS.lng }))) }) : r.fulfill({ status: 404, body: 'not found' }));
  await ctx.route('**/data/speed_cameras.json', r => cams ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(cams) }) : r.fulfill({ status: 404, body: 'not found' }));
  await ctx.route('**/dapi.kakao.com/**', r => {
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('query')); log.local.push(q);
    const docs = Object.entries(PLACES).filter(([n]) => n.includes(q)).map(([n, c]) => ({ place_name: n, x: String(c[0]), y: String(c[1]), road_address_name: '서울 시험 주소', address_name: '' }));
    r.fulfill({ json: { documents: docs.length ? docs : [{ place_name: q, x: '127.0276', y: '37.4979', address_name: '' }] } });
  });
  await ctx.route('**/apis-navi.kakaomobility.com/**', r => {
    const sp = new URL(r.request().url()).searchParams;
    log.dir.push({ origin: sp.get('origin'), priority: sp.get('priority'), via: (sp.get('waypoints') || '').split('|').filter(Boolean).length });
    if (dirStatus !== 200) return r.fulfill({ status: dirStatus, json: { msg: 'err' } });
    const o = sp.get('origin').split(',').map(Number), d = sp.get('destination').split(',').map(Number);
    const wp = (sp.get('waypoints') || '').split('|').filter(Boolean).map(s => s.split(',').map(Number));
    const pts = [o, ...wp, d]; let v = [], dist = 0;
    for (let i = 0; i < pts.length - 1; i++) { v = v.concat(lerp(pts[i], pts[i + 1], 30)); dist += hv([pts[i][1], pts[i][0]], [pts[i + 1][1], pts[i + 1][0]]); }
    const dur = Math.round(dist * 1.25 / 30000 * 3600), n3 = Math.floor(v.length / 6) * 2;      // 좌표를 3개 도로로 나눈다 (교통 정보가 있을 때: 원활 25% · 정체 50% · 서행 25% 시간)
    const roads = traffic
      ? [[0, n3, 4, .25], [n3, 2 * n3, 1, .5], [2 * n3, v.length, 3, .25]].map(([a, b, st, k]) => ({ name: '시험로', distance: 1000, duration: dur * k, traffic_speed: 30, traffic_state: st, vertexes: v.slice(a, b) }))
      : [{ vertexes: v }];
    r.fulfill({ json: { routes: [{ summary: { duration: dur, distance: Math.round(dist * 1.25) }, sections: [{ roads, guides: [{ x: d[0], y: d[1], guidance: '도착' }] }] }] } });
  });
  await ctx.route('**unpkg.com/**', r => {
    if (!stub) return r.abort();
    r.request().url().endsWith('.js') ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(FX, 'stub-leaflet.js'), 'utf8') }) : r.fulfill({ contentType: 'text/css', body: '' });
  });
  const mkPage = async () => { const p = await ctx.newPage(); p.on('pageerror', e => log.errs.push(`${p.url().split('/').pop()}: ${e.message}`)); return p; };
  return { ctx, log, mkPage };
}

/* ---------- 간단한 시험 틀 ---------- */
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
const section = t => console.log(`\n── ${t}`);
const compareUrl = (o, d) => `${B}pages/compare.html?origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}`;

const browser = await chromium.launch();
try {
  /* 1. 경로 비교 */
  section('경로 비교 · 안전 경로 후보');
  {
    const { ctx, log, mkPage } = await mkContext(await browser, { stub: true });
    const p = await mkPage();
    await p.goto(compareUrl('A점', 'B점')); await p.waitForSelector('.rt-card', { timeout: 15000 });
    const cards = await p.locator('.rt-card').allInnerTexts();
    const min = c => Number(/(\d+)\s*분/.exec(c)[1]), sc = c => Number(/지나는 사고\s*(\d+)건/.exec(c)[1]);
    const [safe, fast] = cards;      // 안전 경로가 왼쪽(첫 번째)
    check('안전 경로가 빠른 경로보다 지나는 사고가 적다', sc(safe) < sc(fast), `${sc(fast)}건 → ${sc(safe)}건`);
    check('안전 경로는 시간 제한(1.35배) 안', min(safe) <= min(fast) * 1.35, `${min(fast)}분 → ${min(safe)}분`);
    check('길찾기 호출은 기본 3회 + 우회 최대 8회', log.dir.length >= 4 && log.dir.length <= 11, `${log.dir.length}회`);
    check('우회 호출은 경유지 1개를 붙여 부른다', log.dir.some(c => c.via === 1));
    check('차이 요약(시간·다발지점·사고)이 보인다', (await p.locator('.delta > div').count()) === 3);
    check('지도(경로 겹쳐 보기)가 그려진다', await p.locator('#cmpMap').isVisible() && (await p.evaluate(() => window.__lcalls.polyline)) >= 4);
    if (process.env.SHOT) await p.screenshot({ path: '/tmp/cmp.png' });
    await p.click('.rt-card[data-type="fast"]');
    check('카드를 누르면 선택이 바뀌고 안내 링크도 바뀐다', (await p.getAttribute('#goDrive', 'href')).includes('type=fast'));
    const years = await p.evaluate(async () => { const r = await loadHazards(); return { ys: [...new Set(r.filter(x => x.source !== 'user').map(x => x.year))], all: (await loadAllHazards()).length, n: r.length }; });
    check('위험 구간은 가장 최신 연도 하나로 통일된다 (전체 중 최신 연도만)', years.ys.length === 1 && years.ys[0] === LATEST && years.n === N_LATEST && years.all === DALL.length, JSON.stringify(years));
    check('지도가 설명·경로 선택보다 위에 있다', await p.evaluate(() => { const m = document.getElementById('cmpMap'), c = document.getElementById('routeCards'); return !!(m.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    check('공유 버튼이 있다', await p.locator('#shareRoute').isVisible());
    const nBasis = Number(/후보 경로 (\d+)개/.exec(await p.textContent('#candBox summary'))[1]);
    check('후보 목록의 개수가 안내 문구의 후보 수와 같다', (await p.locator('#candList li').count()) === nBasis, `${nBasis}개`);
    await p.click('#candBox summary');
    check('후보 목록에 선택된 안전 경로와 탈락 이유가 보인다', (await p.locator('#candList li.on').count()) === 1 && /시간 초과|사고가 줄지 않음|더 안전한 후보|빠른 경로/.test(await p.locator('#candList').innerText()));
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(compareUrl('강남역', '서울역')); await p.waitForSelector('#verdict:not([hidden])', { timeout: 15000 });
    check('더 안전한 길이 없으면 솔직하게 알린다', (await p.textContent('#verdict')).includes('더 안전한 길을 찾지 못했어요'));
    check('출발지·도착지 근처라 피하기 어려운 지점을 설명한다', (await p.textContent('#verdict')).includes('어떤 길로 가도'));
    check('같은 경로일 땐 고르는 카드 없이 설명 상자에 시간·거리·사고가 합쳐진다', (await p.locator('.rt-card').count()) === 0 && (await p.locator('#verdict .delta > div').count()) === 3);
    check('설명 상자는 지도 바로 아래에 있다', await p.evaluate(() => document.getElementById('cmpMap').nextElementSibling.id === 'verdict'));
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser, { dirStatus: 401 });
    const p = await mkPage();
    await p.goto(compareUrl('강남역', '서울역')); await p.waitForSelector('.empty', { timeout: 15000 });
    check('키 오류(401)는 원인을 알려 주는 문구로 보인다', (await p.locator('.empty').innerText()).includes('카카오에서 요청을 받아 주지 않았어요'));
    check('오류 카드는 제목 아래에 놓인다', await p.evaluate(() => [...document.querySelector('main').children].findIndex(e => e.classList.contains('route-title')) < [...document.querySelector('main').children].findIndex(e => e.classList.contains('empty'))));
    check('오류에서는 즐겨찾기·공유 줄이 숨고 다시 시도 버튼이 있다', await p.locator('#favRow').isHidden() && (await p.locator('#retryRoute').count()) === 1);
    await ctx.close();
  }

  /* 2. 안내(내비) 음성 */
  section('안내 · 음성');
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.addInitScript(() => { window.__sp = 0; Object.defineProperty(window, 'speechSynthesis', { value: { speak() { window.__sp++; }, cancel() {}, getVoices() { return []; } }, configurable: true }); window.SpeechSynthesisUtterance = function (t) { this.text = t; }; });
    await p.goto(`${B}pages/drive.html?origin=${encodeURIComponent('A점')}&destination=${encodeURIComponent('B점')}&type=safe`); await p.waitForTimeout(1500);
    check('연습 모드: 음성 버튼 숨김 · 안내 문구 표시', await p.locator('#voiceBtn').isHidden() && await p.locator('#simNote').isVisible());
    await p.click('#playBtn'); await p.click('[data-speed="4"]'); await p.waitForTimeout(9000);
    check('연습 모드: 주행 중 음성이 한 번도 나오지 않는다', (await p.evaluate(() => window.__sp)) === 0);
    await p.click('[data-mode="gps"]'); await p.waitForTimeout(600);
    check('실제 GPS 모드: 음성 버튼이 보인다', await p.locator('#voiceBtn').isVisible());
    await p.evaluate(() => speak('시험'));
    check('실제 GPS 모드: 음성이 나온다', (await p.evaluate(() => window.__sp)) >= 1);
    await p.click('#voiceBtn'); await p.evaluate(() => { window.__sp = 0; speak('시험'); });
    check('음성을 끄면 나오지 않는다', (await p.evaluate(() => window.__sp)) === 0);
    await ctx.close();
  }

  /* 2-2. 안내(내비) : 진행 방향이 위로 가는 지도 */
  section('안내 · 진행 방향 지도');
  {
    const { ctx, mkPage } = await mkContext(await browser, { stub: true });
    const p = await mkPage();
    await p.addInitScript(() => { window.__wl = 0; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__wl++; return { addEventListener() {}, release: async () => { window.__wl--; } }; } } }); });
    await p.goto(`${B}pages/drive.html?origin=${encodeURIComponent('A점')}&destination=${encodeURIComponent('B점')}&type=fast`); await p.waitForSelector('#tmap', { timeout: 8000 }); await p.waitForTimeout(600);
    const st = () => p.evaluate(() => { const el = document.getElementById('tmap'), ic = tm.car.getElement().firstChild, box = document.querySelector('.navmap').getBoundingClientRect();
      return { rot: el.classList.contains('rot'), tf: el.style.transform, ic: ic.style.transform, w: parseFloat(el.style.width), h: parseFloat(el.style.height), l: parseFloat(el.style.left), t: parseFloat(el.style.top), bw: box.width, bh: box.height, hd: tm.hd, mr: tm.rot, compass: !document.getElementById('compassBtn').hidden, carfix: getComputedStyle(document.querySelector('.carfix')).display, carm: getComputedStyle(document.querySelector('.carm')).visibility, tilt: document.querySelector('.navmap').classList.contains('tilt') }; });
    const rz = t => parseFloat(/rotateZ\((-?[\d.]+)deg\)/.exec(t || '')?.[1]);          // rotateZ(…deg) 의 각도
    let a = await st();
    check('지도가 진행 방향 위(회전)이면서 눕힌(3D) 상태로 시작한다', a.rot && a.tilt && a.compass && /perspective\(\d+px\) rotateX\(\d+deg\) rotateZ\(/.test(a.tf), a.tf);
    check('지도 방향 = 경로 진행 방향 (A→B 는 북북동 약 27°)', Math.abs(a.mr - 27) < 3, `${a.mr.toFixed(1)}°`);
    check('지도는 차 방향의 반대로 돌고(rotateZ = -방향), 눕히면 차는 화면에 고정된 그림으로 바뀐다', Math.abs(rz(a.tf) + a.hd) < 0.01 && a.carfix !== 'none' && a.carm === 'hidden', `${a.tf} / hd ${a.hd.toFixed(2)} / carfix ${a.carfix} / 지도 위 차 ${a.carm}`);
    /* 눕힌 지도가 화면(안개 아래 보이는 부분)을 어느 방향으로 돌려도 빈 곳 없이 덮는다: 화면 모서리를 지도 위 거리로 거꾸로 풀어 지도 반지름과 견준다 */
    const cover = await p.evaluate(() => { const el = document.getElementById('tmap'), D = parseFloat(el.style.width), box = document.querySelector('.navmap').getBoundingClientRect();
      const w = box.width, h = box.height, cx = w / 2, cy = h * ANCHOR, top = h * FADE; let worst = 0;
      for (const [sx, sy] of [[0, top], [w, top], [0, h], [w, h], [w / 2, top], [w / 2, h]]) { const [px, py] = planeOf(sx - cx, sy - cy); worst = Math.max(worst, Math.hypot(px, py)); }
      return { D, worst, ok: D / 2 >= worst, cy: ANCHOR }; });
    check('0~360° 어느 방향에서도 눕힌 화면 모서리가 빈 채로 보이지 않는다', cover.ok, `지도 ${cover.D}px ≥ 필요 ${Math.ceil(cover.worst * 2)}px · 차 위치 세로 ${(cover.cy * 100).toFixed(0)}%`);
    /* 원근 투영 계산(planeOf)이 실제 브라우저가 그리는 위치와 맞는지: 지도 위에 점을 찍어 화면에서 어디에 나타나는지 잰다 */
    const proj = await p.evaluate(() => {
      car.head = 0; syncTiles(); const el = document.getElementById('tmap'); el.style.transition = 'none'; void el.offsetWidth;
      const D = parseFloat(el.style.width), box = document.querySelector('.navmap').getBoundingClientRect(), w = box.width, h = box.height, cx = w / 2, cy = h * ANCHOR;
      let worst = 0; const rows = [];
      for (const [sx, sy] of [[cx, h * FADE + 10], [cx, cy], [cx, h - 5], [30, h * 0.5], [w - 30, h * 0.5], [10, h * FADE + 10]]) {
        const [px, py] = planeOf(sx - cx, sy - cy), pr = document.createElement('i');
        pr.style.cssText = `position:absolute;width:2px;height:2px;left:${D / 2 + px - 1}px;top:${D / 2 + py - 1}px`; el.appendChild(pr);
        const r = pr.getBoundingClientRect(), gx = r.left + r.width / 2 - box.left, gy = r.top + r.height / 2 - box.top;
        worst = Math.max(worst, Math.hypot(gx - sx, gy - sy)); rows.push([Math.round(sx), Math.round(sy), Math.round(gx), Math.round(gy)]); pr.remove();
      }
      el.style.transition = ''; car.head = 27.26; syncTiles(); return { worst, rows };
    });
    check('눕힌 지도 투영 계산이 실제 브라우저가 그리는 화면 위치와 맞는다 (오차 1.5px 이내)', proj.worst < 1.5, `최대 오차 ${proj.worst.toFixed(2)}px`);
    /* 방향이 바뀔 때 가까운 쪽으로 돈다 */
    const sweep = await p.evaluate(() => { const out = []; for (const h of [350, 10, 170, -170, 90]) { car.head = h; syncTiles(); out.push(Math.round(tm.rot)); } return out; });
    const steps = sweep.slice(1).map((v, i) => Math.abs(v - sweep[i]));
    check('350°→10° 처럼 경계를 넘을 때 20°만 돈다 (340° 거꾸로 돌지 않는다)', steps.every(x => x <= 180) && steps[0] === 20, sweep.join(' → '));
    /* 연습 주행 중 계속 따라간다 */
    await p.click('#playBtn'); await p.waitForTimeout(1500);
    check('주행 중에도 화면 꺼짐 방지가 켜진다', (await p.evaluate(() => window.__wl)) === 1);
    await p.click('#playBtn');
    await p.waitForTimeout(100);
    check('일시정지하면 화면 꺼짐 방지가 풀린다', (await p.evaluate(() => window.__wl)) === 0);
    check('출처 © OpenStreetMap 표기가 화면에 고정돼 보인다', (await p.locator('.osm-attr').isVisible()) && (await p.textContent('.osm-attr')).includes('OpenStreetMap'));
    /* 전체 보기 = 북쪽이 위 */
    await p.click('#viewBtn'); await p.waitForTimeout(200); a = await st();
    check('전체 보기에서는 지도를 돌리지 않고 나침반도 숨는다', !a.rot && a.tf === '' && !a.compass);
    check('전체 보기에서 경로 전체에 맞춰 보여 준다', (await p.evaluate(() => window.__lcalls.fitBounds)) >= 1);
    await p.click('#viewBtn'); await p.waitForTimeout(200); a = await st();
    check('따라가기로 돌아오면 다시 진행 방향이 위로 간다', a.rot && a.compass);
    /* 나침반으로 북쪽 고정 */
    await p.click('#compassBtn'); await p.waitForTimeout(150); a = await st();
    check('나침반을 누르면 북쪽이 위로 고정된다 (돌지 않는 지도)', !a.rot && (await p.getAttribute('#compassBtn', 'aria-pressed')) === 'false' && (await p.locator('.toast').count()) >= 1);
    await p.click('#compassBtn'); await p.waitForTimeout(150); a = await st();
    check('다시 누르면 진행 방향 위로 돌아온다', a.rot && (await p.getAttribute('#compassBtn', 'aria-pressed')) === 'true');
    /* 다발지점 목록을 누르면 회전을 풀고 그 지점을 북쪽이 위인 지도로 */
    const hasPts = (await p.locator('#pointList [data-i]').count()) > 0;
    if (hasPts) { await p.click('#pointList [data-i="0"]'); await p.waitForTimeout(200); a = await st(); check('다발지점을 누르면 회전을 풀고 그 지점을 보여 준다', !a.rot && !a.compass); }
    /* 실제 GPS 에서도 화면 꺼짐 방지 */
    await p.click('[data-mode="gps"]'); await p.waitForTimeout(500);
    check('실제 GPS 안내 중에는 화면이 꺼지지 않게 한다', (await p.evaluate(() => window.__wl)) === 1);
    await p.click('[data-mode="sim"]'); await p.waitForTimeout(300);
    check('연습으로 돌아가면 화면 꺼짐 방지가 풀린다', (await p.evaluate(() => window.__wl)) === 0);
    /* 화면 크기가 바뀌면(가로 보기 등) 지도 크기를 다시 계산한다 */
    await p.click('#viewBtn'); await p.waitForTimeout(150);                    // 지점 보기(자유) → 따라가기
    const before = (await st()).w;
    await p.setViewportSize({ width: 340, height: 700 }); await p.waitForTimeout(400);
    const after = await st();
    check('화면 폭이 바뀌면 회전 지도 크기를 다시 맞춘다', after.w !== before && after.l + after.w / 2 > 0, `${Math.round(before)}px → ${Math.round(after.w)}px`);
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser);                       // 지도를 못 불러오면 약식 경로 그림(SVG)으로 대신한다
    const p = await mkPage();
    await p.goto(`${B}pages/drive.html?origin=${encodeURIComponent('A점')}&destination=${encodeURIComponent('B점')}&type=safe`); await p.waitForTimeout(1800);
    check('지도를 못 불러와도 약식 경로 그림이 보이고 나침반·출처 표기는 숨는다', (await p.locator('#map').isVisible()) && (await p.locator('#compassBtn').isHidden()) && (await p.locator('.osm-attr').isHidden()));
    await ctx.close();
  }

  /* 2-3. 안내(내비) : 남은 시간 · 도착 시각 · 교통 막대 · 제한속도 */
  section('안내 · 남은 시간 · 교통 막대 · 제한속도');
  {
    const A = PLACES['A점'], Bp = PLACES['B점'], at = t => [A[0] + (Bp[0] - A[0]) * t, A[1] + (Bp[1] - A[1]) * t];
    const cam = (t, limit, dLat = 0) => { const [x, y] = at(t); return { id: `c${t}`, lat: y + dLat, lng: x, limit, kind: '1', zone: null, road: '시험로', place: '시험', sgg: null }; };
    const CAMS = [cam(0.06, 60), cam(0.5, null), cam(0.3, 30, 0.0016)];        // 경로 위 60km/h · 경로 위 제한속도 없음 · 경로에서 약 180m 떨어진 카메라(걸러져야 함)
    const url = `${B}pages/drive.html?origin=${encodeURIComponent('A점')}&destination=${encodeURIComponent('B점')}&type=fast`;
    const { ctx, mkPage } = await mkContext(await browser, { stub: true, cams: CAMS });
    const p = await mkPage();
    await p.goto(url); await p.waitForSelector('#tmap', { timeout: 8000 }); await p.waitForTimeout(500);
    const txt = sel => p.textContent(sel);
    check('안내 패널에 남은 시간 · 남은 거리 · 도착 시각이 나온다', /^\d+분$|시간/.test(await txt('#npTime')) && /km · .*\d+:\d\d 도착/.test(await txt('#npSub')), `${await txt('#npTime')} / ${await txt('#npSub')}`);
    const rem = await p.evaluate(() => { const d = route.dur, r = route.roads; return { dur: d, n: r.length, st: r.map(x => x.st), a: remainSec(route, 0) / d, b: remainSec(route, r[1].at) / d, c: remainSec(route, r[2].at) / d, mid: remainSec(route, (r[1].at + r[2].at) / 2) / d, end: remainSec(route, total) }; });
    check('길찾기가 준 도로별 소요 시간(원활 25% · 정체 50% · 서행 25%)으로 남은 시간을 계산한다', rem.n === 3 && rem.st.join() === '4,1,3' && Math.abs(rem.a - 1) < .001 && Math.abs(rem.b - .75) < .003 && Math.abs(rem.c - .25) < .003 && Math.abs(rem.mid - .5) < .003 && rem.end === 0, `시작 ${rem.a.toFixed(3)} · 2번째 도로 시작 ${rem.b.toFixed(3)} · 3번째 ${rem.c.toFixed(3)} · 중간 ${rem.mid.toFixed(3)}`);
    check('교통 막대는 없고, 위험구간 안내 카드만 남는다', (await p.locator('#tbar').count()) === 0 && (await p.locator('#alertCard, .alert').count()) >= 0);
    /* 도착 시각 */
    await p.evaluate(() => { pos = 0; update(); }); const e0 = (await txt('#npSub')).split('·')[1];
    await p.evaluate(() => { pos = total * .5; update(); }); const e1 = (await txt('#npSub')).split('·')[1];
    check('연습 주행에서는 도착 시각이 가상 출발 시각 기준으로 고정된다', e0 === e1 && /도착/.test(e0), `${e0.trim()} / ${e1.trim()}`);
    /* 단속 카메라 : 경로 위 것만 */
    check('경로에서 벗어난(약 180m) 카메라는 걸러내고 경로 위 카메라 2곳만 남긴다', (await p.evaluate(() => camList.length)) === 2 && (await p.evaluate(() => camList.map(c => c.cam.id).join())) === 'c0.06,c0.5', await p.evaluate(() => camList.map(c => c.cam.id).join()));
    const sign = () => p.evaluate(() => ({ hidden: document.getElementById('limitSign').hidden, num: document.getElementById('limitNum').textContent, dist: document.getElementById('limitDist').textContent }));
    await p.evaluate(() => { pos = camList[0].at - 700; update(); });
    check('카메라가 500m보다 멀면 제한속도 표지가 없다', (await sign()).hidden);
    await p.evaluate(() => { pos = camList[0].at - 300; update(); });
    let sg = await sign();
    check('300m 앞에 오면 제한속도 60 표지와 거리가 나온다', !sg.hidden && sg.num === '60' && sg.dist === '300m', `${sg.num} / ${sg.dist}`);
    check('음성 안내 기록(실제 GPS 에서만 말한다)이 남는다', await p.evaluate(() => said.has('c0')));
    await p.evaluate(() => { pos = camList[0].at + 60; update(); });
    check('카메라를 지나면 표지가 사라진다', (await sign()).hidden);
    await p.evaluate(() => { pos = camList[1].at - 200; update(); });
    sg = await sign();
    check('제한속도 값이 없는 카메라는 숫자를 지어내지 않고 "단속"으로만 보인다', !sg.hidden && sg.num === '단속' && await p.evaluate(() => document.getElementById('limitNum').classList.contains('nolimit')), `${sg.num} / ${sg.dist}`);
    /* 속도 표시 */
    await p.evaluate(() => { pos = camList[0].at - 200; update(); });
    const spd = async v => { await p.evaluate(x => { mode = 'gps'; gpsWeak = false; gpsSpeed = x; paint(); }, v); return p.evaluate(() => ({ n: document.getElementById('npSpeed').textContent, u: document.getElementById('npUnit').textContent, cls: document.getElementById('npSpd').className })); };
    let r = await spd(72);
    check('GPS 속도가 제한속도(60)를 넘으면 속도 표시가 빨갛게 바뀐다', r.n === '72' && r.u === 'km/h' && /over/.test(r.cls), JSON.stringify(r));
    r = await spd(55); check('제한속도 10km/h 이내로 다가가면 노란 테두리', /near/.test(r.cls) && !/over/.test(r.cls), JSON.stringify(r));
    r = await spd(30); check('넉넉하면 평소 모양', !/near|over/.test(r.cls));
    r = await spd(null); check('기기가 속도를 주지 않으면 0 으로 꾸미지 않고 "-" 로 보인다', r.n === '-', JSON.stringify(r));
    await p.evaluate(() => { mode = 'sim'; gpsSpeed = null; paint(); });
    check('연습 모드에서는 속도 숫자를 보여 주지 않는다 (가상 주행 속도를 실제처럼 꾸미지 않는다)', (await txt('#npUnit')) === '연습' && !/over|near/.test(await p.evaluate(() => document.getElementById('npSpd').className)));
    check('안내 문구에 기준(요청 시점 교통 정보)과 제한속도 범위가 적혀 있다', /길찾기 때의 예상/.test(await txt('#infoNote')) && /단속 카메라 위치에서만/.test(await txt('#infoNote')) && (await txt('#infoNote')).length < 90);
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser, { stub: true, traffic: false });     // 교통 정보도 카메라 파일도 없는 경우
    const p = await mkPage();
    await p.goto(`${B}pages/drive.html?origin=${encodeURIComponent('A점')}&destination=${encodeURIComponent('B점')}&type=fast`); await p.waitForSelector('#tmap', { timeout: 8000 }); await p.waitForTimeout(500);
    const t0 = await p.evaluate(() => ({ time: document.getElementById('npTime').textContent, dur: Math.round(route.dur / 60), sign: document.getElementById('limitSign').hidden, note: document.getElementById('infoNote').textContent }));
    check('도로별 시간이 없으면 전체 소요 시간을 거리 비율로 나눠 쓴다', t0.time === `${t0.dur}분` || t0.time.includes('시간'), `${t0.time} (전체 ${t0.dur}분)`);
    await p.evaluate(() => { pos = total * .5; update(); });
    const half = await p.evaluate(() => ({ s: remainSec(route, total * .5), d: route.dur }));
    check('(거리 비율) 절반 지점의 남은 시간은 전체의 절반', Math.abs(half.s - half.d / 2) < 1);
    check('카메라 파일이 없으면 제한속도 표지는 없고 없다고 알린다', t0.sign && /데이터가 없어/.test(t0.note));
    await ctx.close();
  }

  /* 3. 사고 유형 맞춤 안내 */
  section('사고 유형 맞춤 주의 안내');
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=${TSID}`); await p.waitForTimeout(1200);
    const adv = t => p.evaluate(x => pntAdvice({ pnt: { detail: { types: { [x]: 3, '기타': 1 } } } }), t);
    check('횡단 → 보행자', (await adv('차대사람 · 횡단중')) === '보행자를 주의하세요');
    check('후미추돌 → 앞차 간격', (await adv('차대차 · 후미추돌')) === '앞차와 간격을 넓히세요');
    check('측면직각충돌 → 교차로', (await adv('차대차 · 측면직각충돌')) === '교차로에서 좌우를 살피세요');
    check('정면충돌 → 마주 오는 차량', (await adv('차대차 · 정면충돌')) === '마주 오는 차량에 주의하세요');
    check('전도 → 속도', (await adv('차량단독 · 전도')) === '속도를 줄이세요');
    check('모르는 유형은 문구를 만들지 않는다', (await adv('차대차 · 진행중 접촉')) === '');
    check('연결된 사고 유형이 있으면 안내 문구는 숨는다', await p.locator('#pntNone').isHidden());
    await p.goto(`${B}pages/detail.html?seg=api-2019-11305001`); await p.waitForTimeout(1000);
    check('가까이 연결된 지점이 없으면 이유를 알려 준다', (await p.locator('#pntNone').isVisible()) && (await p.textContent('#pntNone')).includes('연결된 사고 유형'));
    await p.goto(`${B}pages/detail.html?seg=${TSID}`); await p.waitForTimeout(1000);
    check('구간 상세에 운전 팁이 보인다(가짜 시험 데이터 연결)', (await p.locator('#pntTip').isVisible()) && (await p.textContent('#pntTip')).includes('보행자를 주의하세요'));
    await ctx.close();
  }

  {
    const { ctx, mkPage } = await mkContext(await browser, { pnt: false });
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=${TSID}`); await p.waitForTimeout(1200);
    check('사고 유형 파일이 없으면 "불러오지 못했어요"라고 알려 준다', (await p.locator('#pntNone').isVisible()) && (await p.textContent('#pntNone')).includes('불러오지 못했어요') && await p.locator('#pntBox').isHidden());
    await ctx.close();
  }

  /* 4. 자동완성 */
  section('장소 자동완성');
  {
    const { ctx, log, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(`${B}pages/route.html`); await p.waitForTimeout(400);
    await p.fill('#ro', '강남'); await p.waitForTimeout(700);
    check('후보 목록이 뜬다', (await p.locator('#sug-ro li').count()) >= 3 && await p.locator('#sug-ro').isVisible());
    await p.keyboard.press('Escape');
    check('Esc는 목록만 닫고 입력을 지우지 않는다', await p.locator('#sug-ro').isHidden() && (await p.inputValue('#ro')) === '강남');
    await p.fill('#ro', '강남'); await p.waitForTimeout(700);
    const first = await p.locator('#sug-ro li b').first().innerText();
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    check('방향키+Enter로 고르면 이름이 들어가고 도착지로 이동', (await p.inputValue('#ro')) === first && await p.evaluate(() => document.activeElement.id === 'rd'));
    check('고르기만 했을 때는 다음 화면으로 넘어가지 않는다', p.url().includes('route.html'));
    await p.fill('#rd', '서울역'); await p.waitForTimeout(700);
    await p.locator('#sug-rd li').nth(1).dispatchEvent('pointerdown'); await p.waitForTimeout(300);
    check('눌러서(터치) 고를 수 있다', (await p.inputValue('#rd')) === '서울역 1호선');
    log.local.length = 0; log.dir.length = 0;
    await p.click('#goRoute'); await p.waitForURL('**/compare.html*'); await p.waitForSelector('.rt-card', { timeout: 15000 });
    check('고른 장소는 이름을 다시 검색하지 않는다', log.local.length === 0);
    check('길찾기에 고른 장소의 좌표를 쓴다', log.dir[0].origin === '127.0276,37.4979');
    await ctx.close();
  }

  /* 5. 지도 */
  section('지도');
  {
    const { ctx, mkPage } = await mkContext(await browser, { stub: true });
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=${TSID}`); await p.waitForTimeout(1200);
    check('구간 상세: 지도가 맨 위(첫 번째)에 있다', await p.evaluate(() => document.querySelector('main').firstElementChild.id === 'heroMap') && await p.locator('#heroMap').isVisible());
    check('구간 상세: 좌표 대체 카드는 숨는다', await p.locator('#mapView').isHidden());
    await p.goto(`${B}pages/list.html`); await p.waitForTimeout(1200);
    check('위험 구간 목록: 지도에 최신 연도 구간 전부가 점으로 찍힌다', (await p.evaluate(() => window.__lcalls.circle)) === N_LATEST);
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser);                       // 지도 라이브러리를 못 불러오는 상황
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=${TSID}`); await p.waitForTimeout(1200);
    check('지도를 못 불러오면 좌표 안내 카드가 보인다', await p.locator('#heroMap').isHidden() && await p.locator('#mapView').isVisible());
    await ctx.close();
  }

  /* 6. 오프라인 */
  section('오프라인');
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(`${B}pages/list.html`);
    await p.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, null, { timeout: 15000 });
    await p.waitForTimeout(1500);
    await p.reload(); await p.waitForTimeout(600);
    await ctx.setOffline(true); await p.waitForTimeout(300);
    check('오프라인 안내 띠가 보인다', await p.locator('.offline').isVisible());
    await p.goto(`${B}pages/list.html`); await p.waitForTimeout(1200);
    check('오프라인에서도 위험 구간 목록이 열린다', new RegExp(String(N_LATEST)).test(await p.textContent('#resultCount')));
    await p.goto(`${B}index.html`); await p.waitForTimeout(1000);
    check('오프라인에서도 홈이 열린다', (await p.locator('#topList .card').count()) >= 5);
    await ctx.setOffline(false); await p.waitForTimeout(300);
    await ctx.close();
  }

  /* 7. 화면 · 접근성 */
  section('화면');
  {
    const { ctx, mkPage } = await mkContext(await browser, { stub: true });
    const p = await mkPage();
    const pages = ['index.html', 'pages/route.html', 'pages/list.html', 'pages/my.html', 'pages/data.html', `pages/detail.html?seg=${TSID}`, 'pages/report.html', 'pages/signup.html',
      'pages/compare.html?origin=A점&destination=B점', 'pages/preview.html?origin=A점&destination=B점', 'pages/drive.html?origin=A점&destination=B점&type=safe'];
    let footers = 0, header = 0;
    for (const u of pages) { await p.goto(B + u); await p.waitForTimeout(500); footers += await p.locator('.foot').count(); header += await p.locator('#infoBtn').count(); }
    check('모든 화면에 하단 출처 문구(푸터)와 헤더 ⓘ 버튼이 없다', footers === 0 && header === 0);
    await p.goto(`${B}pages/my.html`); await p.waitForTimeout(400); await p.click('.menu-row[data-info]');
    check('마이 > 데이터 출처 · 이용 안내 시트가 열린다', await p.locator('#infoSheet').evaluate(e => e.classList.contains('on')));
    await p.keyboard.press('Escape');
    check('Esc로 시트가 닫힌다', !(await p.locator('#infoSheet').evaluate(e => e.classList.contains('on'))));
    for (const w of [375, 393, 440]) {
      await p.setViewportSize({ width: w, height: 852 });
      let over = 0;
      for (const u of pages) { await p.goto(B + u); await p.waitForTimeout(350); if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) over++; }
      check(`${w}px: 가로로 넘치는 화면이 없다`, over === 0, over ? `${over}개 화면` : '');
    }
    await ctx.close();
  }
  /* 8. 가입 · 로그인 */
  section('가입 · 실습 모드 (회원 서버 없음)');
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(`${B}pages/signup.html?mode=login`); await p.waitForTimeout(700);
    check('서버가 없으면 실습 모드 안내가 보이고 로그인 전환·개인정보 문구는 숨는다', (await p.locator('#modeNote').innerText()).includes('실습 모드') && await p.locator('#swapRow').isHidden() && await p.locator('#privacy').isHidden());
    check('서버가 없으면 ?mode=login 이어도 가입 화면(닉네임 칸 있음)', await p.locator('#nickField').isVisible());
    await p.fill('#nickname', '연습생'); await p.fill('#email', 'me@example.com'); await p.click('#sendCode'); await p.waitForTimeout(200);
    const dc = await p.locator('.devcode').innerText();
    check('실습 모드: 인증번호가 화면에 보인다', /^\d{6}$/.test(dc));
    await p.fill('#code', dc === '123456' ? '654321' : '123456'); await p.click('#verify');
    check('틀린 번호는 오류 문구', (await p.locator('#errMsg').innerText()).includes('맞지 않아요'));
    await p.fill('#code', dc); await p.click('#verify'); await p.click('#join'); await p.waitForTimeout(150);
    const u = await p.evaluate(() => ({ user: JSON.parse(localStorage.getItem('sd_user')), tk: localStorage.getItem('sd_token') }));
    check('실습 모드 가입: 이 기기에만 저장되고 서버 토큰은 없다', u.user && u.user.nickname === '연습생' && !u.user.server && u.tk === null);
    await ctx.close();
  }

  section('가입 · 로그인 · 탈퇴 · 기기 간 저장 (실제 회원 서버 + DB 와 함께)');
  {
    const port = 35000 + Math.floor(Math.random() * 900);
    const child = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DB: 'sqlite', SQLITE_PATH: ':memory:', APP_SECRET: 'e2e'.repeat(12), RESEND_COOLDOWN_S: '2', DEV_SHOW_CODE: '', NODE_ENV: '', SMTP_HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const codes = () => [...out.matchAll(/제목: \[Safe Drive\] .+? 인증번호 (\d{6})/g)].map(m => m[1]);
    const nextCode = async n => { for (let i = 0; i < 100 && codes().length <= n; i++) await new Promise(r => setTimeout(r, 100)); return codes()[n]; };
    const PW = 'Drive2026safe';
    try {
      for (let i = 0; i < 50 && !out.includes('Safe Drive 서버'); i++) await new Promise(r => setTimeout(r, 100));
      const S = `http://127.0.0.1:${port}/`;
      const mk = async () => { const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } }); const log = { local: [], dir: [], errs: [] }; ALL_LOGS.push(log); const p = await ctx.newPage(); p.on('pageerror', e => log.errs.push(`${p.url().split('/').pop()}: ${e.message}`)); return { ctx, p }; };
      const ls = (p, k) => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), k);
      const login = async (p, email, pw) => { await p.goto(S + 'pages/signup.html?mode=login'); await p.waitForTimeout(700); await p.fill('#email', email); await p.fill('#password', pw); await p.click('#join'); await p.waitForTimeout(900); };
      const { ctx, p } = await mk();
      await p.goto(S + 'pages/signup.html'); await p.waitForTimeout(800);
      check('서버가 있으면 개발 모드 안내(메일 미설정)·개인정보 문구·로그인 전환·비밀번호 칸이 보인다', (await p.locator('#modeNote').innerText()).includes('개발 모드') && await p.locator('#privacy').isVisible() && await p.locator('#swapMode').isVisible() && await p.locator('#password').isVisible());
      await p.fill('#nickname', '안전운전'); await p.fill('#email', 'Tester@Example.com'); await p.click('#sendCode');
      const c1 = await nextCode(0);
      await p.waitForFunction(() => /메일함/.test(document.getElementById('sentMsg')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
      check('인증번호는 화면이 아니라 서버(메일 자리)로만 나간다', !!c1 && (await p.locator('.devcode').count()) === 0 && (await p.locator('#sentMsg').innerText()).includes('메일함'));
      check('보낸 직후 재전송 버튼은 잠긴다(60초 간격)', await p.locator('#sendCode').isDisabled() && (await p.locator('#sendCode').innerText()).includes('재전송'));
      await p.fill('#code', c1 === '000000' ? '111111' : '000000'); await p.click('#verify'); await p.waitForTimeout(200);
      check('틀린 번호: 남은 시도 횟수를 알려 준다', (await p.locator('#errMsg').innerText()).includes('4번 더'));
      await p.fill('#code', c1); await p.click('#verify'); await p.waitForTimeout(200);
      check('맞는 번호: 이메일 인증 완료, 비밀번호를 넣기 전에는 가입하기가 잠겨 있다', await p.locator('#state-verified').isVisible() && await p.locator('#join').isDisabled());
      await p.fill('#password', 'abcdefgh'); await p.fill('#password2', 'abcdefgh');
      check('숫자가 없는 비밀번호는 가입 버튼이 안 켜진다', await p.locator('#join').isDisabled());
      await p.fill('#password', PW); await p.fill('#password2', PW + 'x');
      check('비밀번호 확인이 다르면 가입 버튼이 안 켜진다', await p.locator('#join').isDisabled());
      await p.fill('#password2', PW);
      check('조건에 맞고 서로 같으면 가입하기가 켜진다', await p.locator('#join').isEnabled());
      await p.click('#join'); await p.waitForSelector('#state-join-done.on', { timeout: 4000 });
      const sess = await p.evaluate(() => ({ user: JSON.parse(localStorage.getItem('sd_user')), tk: localStorage.getItem('sd_token'), raw: JSON.stringify(localStorage) }));
      check('가입하면 로그인 토큰이 이 기기에 저장된다 (이메일은 소문자로 정리)', sess.user.server === true && sess.user.email === 'tester@example.com' && /^[\w-]{40,}$/.test(sess.tk));
      check('비밀번호는 이 기기 저장소 어디에도 남지 않는다', !sess.raw.includes(PW));
      /* 서버 DB 에 올리는 데이터: 제보 · 최근 검색 / 이 기기에만: 즐겨찾기 */
      await p.goto(S + 'pages/report.html'); await p.waitForTimeout(500);
      await p.fill('#roadName', '서버저장 도로'); await p.fill('#address', '서울특별시 강남구 서버동'); await p.selectOption('#riskLevel', '3'); await p.fill('#accidentCount', '4');
      await p.click('#submit'); await p.waitForTimeout(900);
      await p.evaluate(() => { toggleRouteFav('A점', 'B점'); addRecent('강남역'); addRecentRoute('C점', 'D점'); }); await p.waitForTimeout(600);
      const srv = await p.evaluate(async t => (await (await fetch('/api/me/data', { headers: { Authorization: 'Bearer ' + t } })).json()), sess.tk);
      const rep1 = await ls(p, 'sd_reports');
      check('제보가 서버 DB 에 저장되고, 이 기기에는 복사본(remote 표시)이 남는다', srv.reports?.length === 1 && srv.reports[0].roadName === '서버저장 도로' && rep1.length === 1 && rep1[0].remote === true && /^user-/.test(rep1[0].segmentId), JSON.stringify(srv).slice(0, 160));
      check('최근 검색(검색어·경로)도 서버 DB 에 저장된다', (srv.recents || []).length === 2, JSON.stringify(srv).slice(0, 200));
      check('즐겨찾기는 서버로 보내지 않는다 (이 기기에만)', !JSON.stringify(srv).includes('A점') && (await ls(p, 'sd_favorites')).length === 1);
      check('저장 키는 sd_ 로 시작하고 저장 형식 번호가 있다', await p.evaluate(() => Object.keys(localStorage).every(k => k.startsWith('sd_')) && localStorage.getItem('sd_schema') === '2'));
      /* 마이 */
      await p.goto(S + 'pages/my.html'); await p.waitForTimeout(900);
      check('마이: 닉네임 · 로그아웃 · 회원 탈퇴 메뉴가 보이고 이메일은 가려진다', (await p.locator('#profileName').innerText()).includes('안전운전') && (await p.locator('#profileBtn').innerText()) === '로그아웃' && await p.locator('#withdrawRow').isVisible() && (await p.locator('#profileSub').innerText()).includes('te****@'));
      /* 다른 기기(새 브라우저 칸)에서 로그인 → 제보·최근 검색은 보이고 즐겨찾기는 없다 */
      const { ctx: ctx2, p: p2 } = await mk();
      await login(p2, 'tester@example.com', PW);
      check('비밀번호로 로그인된다', (await p2.evaluate(() => JSON.parse(localStorage.getItem('sd_user') || 'null')))?.nickname === '안전운전');
      await p2.goto(S + 'pages/my.html'); await p2.waitForTimeout(1000);
      const rep2 = await ls(p2, 'sd_reports'), rc2 = await ls(p2, 'sd_recent');
      check('다른 기기에서도 내 제보와 최근 검색이 그대로 보인다', rep2?.length === 1 && rep2[0].roadName === '서버저장 도로' && rc2?.length === 2 && (await p2.locator('#reportList').textContent()).includes('서버저장 도로'), JSON.stringify({ r: rep2, c: rc2?.length, t: (await p2.locator('body').innerText()).slice(0, 300) }));
      check('다른 기기에는 즐겨찾기가 없다 (기기별 저장)', ((await ls(p2, 'sd_favorites')) || []).length === 0);
      /* 삭제는 서버에도 반영 */
      await p2.evaluate(async () => { await removeItem('report', getReports()[0].segmentId); }); await p2.waitForTimeout(500);
      const srv2 = await p.evaluate(async t => (await (await fetch('/api/me/data', { headers: { Authorization: 'Bearer ' + t } })).json()), sess.tk);
      check('한 기기에서 지운 제보는 서버에서도 지워진다', srv2.reports.length === 0 && ((await ls(p2, 'sd_reports')) || []).length === 0);
      /* 로그아웃: 서버 로그인 기록과 이 기기의 서버 복사본이 지워지고 즐겨찾기는 남는다 */
      await p.goto(S + 'pages/my.html'); await p.waitForTimeout(600);
      await p.click('#profileBtn'); await p.click('#lgYes'); await p.waitForTimeout(800);
      const afterOut = await p.evaluate(async t => ({ tk: localStorage.getItem('sd_token'), user: localStorage.getItem('sd_user'), rc: localStorage.getItem('sd_recent'), fav: JSON.parse(localStorage.getItem('sd_favorites') || '[]').length, me: (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).status }), sess.tk);
      check('로그아웃하면 토큰·서버 복사본(최근 검색)이 지워지고 서버 로그인 기록도 사라진다', afterOut.tk === null && afterOut.user === null && (afterOut.rc === null || afterOut.rc === '[]') && afterOut.me === 401);
      check('로그아웃해도 이 기기의 즐겨찾기는 남는다', afterOut.fav === 1);
      /* 로그인 실패: 이유를 알려 주지 않는다 */
      await login(p, 'tester@example.com', PW + 'x');
      const m1 = await p.locator('#errMsg').innerText();
      await p.evaluate(() => localStorage.clear());
      await login(p, 'nobody@example.com', PW);
      const m2 = await p.locator('#errMsg').innerText();
      check('틀린 비밀번호와 없는 이메일은 같은 문구라서 가입 여부를 알 수 없다', m1.includes('이메일 또는 비밀번호가 맞지 않아요') && m1 === m2, m1);
      check('로그인 화면: 닉네임 칸과 인증번호 칸이 없고 비밀번호 찾기 링크가 있다', await p.locator('#nickField').isHidden() && await p.locator('#forgotRow').isVisible());
      /* 같은 이메일로 다시 가입 시도: 가입 여부를 드러내지 않고 같은 화면 */
      await p.goto(S + 'pages/signup.html'); await p.waitForTimeout(600);
      await p.fill('#nickname', '새닉네임'); await p.fill('#email', 'tester@example.com'); await p.click('#sendCode'); await p.waitForTimeout(700);
      check('이미 가입한 이메일로 가입해도 화면은 똑같이 "인증번호를 보냈어요"만 보인다', (await p.locator('#state-code-sent.on').count()) === 1 && !(await p.locator('#sentMsg').innerText()).includes('이미 가입') && (await p.locator('#errMsg').innerText()) === '');
      /* 비밀번호 찾기 */
      await p.goto(S + 'pages/signup.html?mode=reset'); await p.waitForTimeout(700);
      await p.fill('#email', 'tester@example.com'); await p.waitForTimeout(2300); const n3 = codes().length; await p.click('#sendCode'); const c3 = await nextCode(n3);
      await p.fill('#code', c3); await p.click('#verify'); await p.waitForTimeout(300);
      const PW2 = 'Newpass2026ok';
      await p.fill('#password', PW2); await p.fill('#password2', PW2); await p.click('#join'); await p.waitForSelector('#state-join-done.on', { timeout: 4000 });
      check('비밀번호를 바꾸면 이 기기는 로그인된다', (await ls(p, 'sd_user'))?.server === true);
      const old = await p2.evaluate(async () => (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('sd_token') } })).status);
      check('비밀번호를 바꾸면 다른 기기의 로그인은 풀린다', old === 401);
      /* 탈퇴: 비밀번호 확인 */
      await p.goto(S + 'pages/my.html'); await p.waitForTimeout(800);
      const tk3 = await p.evaluate(() => localStorage.getItem('sd_token'));
      await p.click('#withdrawRow'); check('탈퇴 확인 창이 열리고 비밀번호 칸이 있다', await p.locator('#withdrawModal.on').count() === 1 && await p.locator('#wdPw').isVisible());
      await p.click('#wdNo'); check('취소하면 닫힌다', await p.locator('#withdrawModal.on').count() === 0);
      await p.click('#withdrawRow'); await p.fill('#wdPw', 'Wrong2026pass'); await p.click('#wdYes'); await p.waitForTimeout(700);
      check('비밀번호가 틀리면 탈퇴되지 않고 오류가 보인다', (await p.locator('#wdErr').isVisible()) && (await p.evaluate(async t => (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).status, tk3)) === 200);
      await p.fill('#wdPw', PW2); await p.click('#wdYes'); await p.waitForTimeout(1000);
      const gone = await p.evaluate(async t => ({ tk: localStorage.getItem('sd_token'), user: localStorage.getItem('sd_user'), me: (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).status }), tk3);
      check('탈퇴하면 서버 계정이 삭제되고 이 기기도 로그아웃된다', gone.tk === null && gone.user === null && gone.me === 401 && (await p.locator('#profileName').innerText()).includes('비회원'));
      await p.goto(S + 'pages/signup.html'); await p.waitForTimeout(500);
      await p.fill('#nickname', '안전운전'); await p.fill('#email', 'tester@example.com'); await p.waitForTimeout(2300); await p.click('#sendCode'); await p.waitForTimeout(600);
      check('탈퇴 뒤에는 같은 이메일·닉네임으로 다시 가입할 수 있다', (await p.locator('#state-code-sent.on').count()) === 1);
      await ctx.close(); await ctx2.close();
    } finally { child.kill(); }
  }

  /* 저장 : LocalStorage · JSON 내려받기/가져오기 */
  section('저장 · LocalStorage · JSON');
  {
    const { ctx, log, mkPage } = await mkContext(await browser, { stub: true });
    const p = await mkPage();
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), k);
    await p.goto(`${B}pages/report.html`);
    await p.fill('#roadName', '시험로 1번 구간'); await p.fill('#address', '서울특별시 강남구 시험동'); await p.selectOption('#riskLevel', '3'); await p.fill('#accidentCount', '7');
    await p.click('#submit');
    let rep = await ls('sd_reports');
    check('제보가 LocalStorage 에 저장된다 (source=user, 값 그대로)', rep?.length === 1 && rep[0].source === 'user' && rep[0].roadName === '시험로 1번 구간' && rep[0].riskLevel === 3 && rep[0].accidentCount === 7, JSON.stringify(rep?.[0]).slice(0, 120));
    await p.fill('#roadName', '').catch(() => {});
    await p.goto(`${B}pages/report.html`); await p.fill('#roadName', '빈칸 시험'); await p.fill('#address', '서울특별시 중구 시험동'); await p.click('#submit');
    rep = await ls('sd_reports');
    check('사고 건수를 비우면 0 이 아니라 null (정보 없음)로 저장된다', rep.length === 2 && rep[0].accidentCount === null);
    const id0 = rep[1].segmentId;
    await p.goto(`${B}pages/report.html?edit=${id0}`); await p.fill('#roadName', '수정된 도로'); await p.click('#submit');
    await p.reload(); rep = await ls('sd_reports');
    check('제보 수정이 저장되고 새로고침해도 유지된다 (개수 그대로)', rep.length === 2 && rep.find(r => r.segmentId === id0).roadName === '수정된 도로' && !!rep.find(r => r.segmentId === id0).updatedAt);
    /* 즐겨찾기 · 최근 검색 */
    await p.goto(`${B}pages/my.html`);
    const r = await p.evaluate(() => {
      const on = toggleRouteFav('A점', 'B점'), has = isRouteFav('A점', 'B점'); for (let i = 0; i < 12; i++) addRecent('검색' + i); addRecent('검색5'); addRecentRoute('A점', 'B점'); addRecentRoute('A점', 'B점');
      return { on, has, rc: getRecent().map(x => x.q || `${x.origin}>${x.destination}`) };
    });
    check('경로 즐겨찾기가 켜지고 저장된다', r.on && r.has && (await ls('sd_favorites')).length === 1);
    check('최근 검색은 최대 10건·최신순, 같은 검색어는 맨 위로 올라오고 중복되지 않는다', r.rc.length === 10 && r.rc[0] === 'A점>B점' && r.rc.filter(x => x === 'A점>B점').length === 1 && r.rc.filter(x => x === '검색5').length === 1 && r.rc[1] === '검색5', r.rc.join(','));
    await p.reload();
    check('새로고침 뒤에도 즐겨찾기·최근 검색·제보가 남아 있다', (await ls('sd_favorites')).length === 1 && (await ls('sd_recent')).length === 10 && (await ls('sd_reports')).length === 2);
    await p.evaluate(() => toggleRouteFav('A점', 'B점'));
    check('즐겨찾기를 다시 누르면 해제된다', (await ls('sd_favorites')).length === 0);
    await p.evaluate(() => toggleRouteFav('A점', 'B점'));
    /* JSON 내려받기 */
    await p.goto(`${B}pages/data.html`); await p.waitForSelector('#dsList .dl');
    const read = async dl => JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    const [d1] = await Promise.all([p.waitForEvent('download'), p.click('.dl[data-id="reports_user"]')]);
    const j1 = await read(d1);
    check('내 제보 JSON 내려받기: 파일명 · 내용이 LocalStorage 와 같다', d1.suggestedFilename().endsWith('.json') && JSON.stringify(j1) === JSON.stringify(await ls('sd_reports')), d1.suggestedFilename());
    const [d2] = await Promise.all([p.waitForEvent('download'), p.click('.dl[data-id="segments_static"]')]);
    const [d3] = await Promise.all([p.waitForEvent('download'), p.click('.dl[data-id="segments_api"]')]);
    const [jj, ja] = [await read(d2), await read(d3)];
    check('J · A 데이터 JSON 내려받기: 건수가 저장 파일과 같고 모두 source 가 맞다', jj.length === DJ.length && ja.length === DA.length && jj.every(x => x.source === 'static') && ja.every(x => x.source === 'api'), `${jj.length} / ${ja.length}`);
    const [d4] = await Promise.all([p.waitForEvent('download'), p.click('#dlAll')]);
    const all = await read(d4);
    check('전체 내려받기: manifest + 모든 데이터셋이 한 파일에 들어 있다', !!all.manifest?.exportedAt && all.reports_user.length === 2 && all.favorites_user.length === 1 && all.segments_static.length === DJ.length && all.segments_api.length === DA.length);
    check('데이터 관리 화면에 예상 건수와 다르다는 경고가 없다', (await p.locator('#dsList .note.err').count()) === 0);
    /* 가져오기 : 삭제 → 되살리기 → 중복 건너뜀 → 잘못된 파일 */
    const fs_ = fs, tmp = os.tmpdir() + '/sd-user.json';
    fs_.writeFileSync(tmp, JSON.stringify({ favorites_user: all.favorites_user, recent_searches_user: all.recent_searches_user, reports_user: all.reports_user }));
    await p.click('#clearBtn'); await p.click('#clearYes');
    check('내 데이터 삭제 후 제보·즐겨찾기·최근 검색이 비고, J·A 는 그대로다', (await ls('sd_reports')).length === 0 && (await ls('sd_favorites')).length === 0 && (await ls('sd_recent')).length === 0 && (await p.textContent('#dsList')).includes('100건'));
    await p.setInputFiles('#importFile', tmp); await p.waitForTimeout(300);
    check('내려받은 JSON 을 가져오면 그대로 되살아난다 (제보 2 · 즐겨찾기 1 · 최근 10)', (await ls('sd_reports')).length === 2 && (await ls('sd_favorites')).length === 1 && (await ls('sd_recent')).length === 10 && JSON.stringify(await ls('sd_reports')) === JSON.stringify(all.reports_user), await p.textContent('#resultMsg'));
    await p.setInputFiles('#importFile', tmp); await p.waitForTimeout(300);
    check('같은 파일을 또 가져와도 중복으로 늘지 않는다', (await ls('sd_reports')).length === 2 && (await ls('sd_recent')).length === 10 && /건너뜀/.test(await p.textContent('#resultMsg')));
    const bad = (name, body) => { const f = os.tmpdir() + '/' + name; fs_.writeFileSync(f, body); return f; };
    await p.setInputFiles('#importFile', bad('bad1.json', '{이건 JSON 이 아니에요')); await p.waitForTimeout(300);
    const e1 = await p.locator('#state-error').isVisible();
    await p.setInputFiles('#importFile', bad('bad2.json', JSON.stringify({ hello: 1 }))); await p.waitForTimeout(300);
    const e2 = await p.locator('#state-error').isVisible();
    await p.setInputFiles('#importFile', bad('bad3.json', JSON.stringify({ reports_user: [{ roadName: 'x' }, 5, null, { roadName: '정상도로', address: '서울특별시 어딘가', riskLevel: 9, source: 'user', segmentId: 'z' }] }))); await p.waitForTimeout(300);
    check('JSON 이 아니거나 항목이 없는 파일은 오류로 알리고 데이터를 건드리지 않는다', e1 && e2 && (await ls('sd_reports')).length === 2);
    check('형식이 틀린 항목(필수값 없음·등급 9)은 건너뛰고 저장하지 않는다', (await ls('sd_reports')).length === 2 && /건너뜀 4건/.test(await p.textContent('#resultMsg')), await p.textContent('#resultMsg'));
    /* 손상된 저장값 */
    await p.evaluate(() => { localStorage.setItem('sd_recent', '{깨짐'); localStorage.setItem('sd_favorites', '{"a":1}'); localStorage.setItem('sd_reports', 'null'); });
    for (const pg of ['my', 'list', 'data', 'report', 'route', '']) { await p.goto(`${B}${pg ? 'pages/' + pg + '.html' : 'index.html'}`); await p.waitForTimeout(250); }
    check('저장값이 깨져도(깨진 JSON · 목록이 아닌 값 · null) 화면이 멈추지 않는다', log.errs.length === 0, log.errs.slice(0, 2).join(' / '));
    check('깨진 값은 빈 목록으로 읽는다', await p.evaluate(() => getRecent().length === 0 && getFavs().length === 0 && getReports().length === 0));
    await ctx.close();
  }

  section('종합');
  const errs = ALL_LOGS.flatMap(l => l.errs);
  check('모든 시험 동안 자바스크립트 오류가 없다', errs.length === 0, errs.slice(0, 3).join(' / '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
