/* e2e.mjs — Safe Drive 자동 점검. 실행: npm test  (설명은 tests/README.md)
   카카오 길찾기·장소 검색과 Leaflet 은 가짜로 대신한다. 키는 필요 없다. */
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(ROOT, 'tests', 'fixtures');
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
async function mkContext(browser, { stub = false, width = 393, keyOk = true, dirStatus = 200, geo = true, pnt = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 852 }, ...(geo ? { permissions: ['geolocation'], geolocation: { latitude: 37.5547, longitude: 126.9707 } } : {}) });
  const log = { local: [], dir: [], errs: [] }; ALL_LOGS.push(log);
  await ctx.route('**/js/config.local.js', r => r.fulfill({ contentType: 'text/javascript', body: keyOk ? "CONFIG.KAKAO_REST_KEY = 'TEST_KEY_NOT_REAL';" : '' }));
  await ctx.route('**/data/pntfr_points.json', r => pnt ? r.fulfill({ contentType: 'application/json', body: fs.readFileSync(path.join(FX, 'pntfr_points.json')) }) : r.fulfill({ status: 404, body: 'not found' }));
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
    r.fulfill({ json: { routes: [{ summary: { duration: Math.round(dist * 1.25 / 30000 * 3600), distance: Math.round(dist * 1.25) }, sections: [{ roads: [{ vertexes: v }], guides: [{ x: d[0], y: d[1], guidance: '도착' }] }] }] } });
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
    const min = c => Number(/(\d+)분/.exec(c)[1]), sc = c => Number(/지나는 사고\s*(\d+)건/.exec(c)[1]);
    const [fast, safe] = cards;
    check('안전 경로가 빠른 경로보다 지나는 사고가 적다', sc(safe) < sc(fast), `${sc(fast)}건 → ${sc(safe)}건`);
    check('안전 경로는 시간 제한(1.35배) 안', min(safe) <= min(fast) * 1.35, `${min(fast)}분 → ${min(safe)}분`);
    check('길찾기 호출은 기본 3회 + 우회 최대 8회', log.dir.length >= 4 && log.dir.length <= 11, `${log.dir.length}회`);
    check('우회 호출은 경유지 1개를 붙여 부른다', log.dir.some(c => c.via === 1));
    check('차이 요약(시간·다발지점·사고)이 보인다', (await p.locator('.delta > div').count()) === 3);
    check('지도(경로 겹쳐 보기)가 그려진다', await p.locator('#cmpMap').isVisible() && (await p.evaluate(() => window.__lcalls.polyline)) >= 4);
    await p.click('.rt-card[data-type="fast"]');
    check('카드를 누르면 선택이 바뀌고 안내 링크도 바뀐다', (await p.getAttribute('#goDrive', 'href')).includes('type=fast'));
    check('공유 버튼이 있다', await p.locator('#shareRoute').isVisible());
    const nBasis = Number(/후보 (\d+)개/.exec(await p.textContent('#basis'))[1]);
    check('후보 목록의 개수가 안내 문구의 후보 수와 같다', (await p.locator('#candList li').count()) === nBasis, `${nBasis}개`);
    await p.click('#candBox summary');
    check('후보 목록에 선택된 안전 경로와 탈락 이유가 보인다', (await p.locator('#candList li.on').count()) === 1 && /시간 초과|사고가 줄지 않음|더 안전한 후보|빠른 경로/.test(await p.locator('#candList').innerText()));
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(compareUrl('강남역', '서울역')); await p.waitForSelector('.rt-card', { timeout: 15000 });
    check('더 안전한 후보가 없으면 솔직하게 알린다', (await p.textContent('#verdict')).includes('대안 경로를 찾지 못했어요'));
    check('출발지·도착지 근처라 피하기 어려운 지점을 설명한다', (await p.textContent('#verdict')).includes('피하기 어려워요'));
    check('같은 경로라는 표시가 안전 경로 카드에 붙는다', (await p.locator('.rt-card[data-type="safe"]').innerText()).includes('빠른 경로와 같아요'));
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
      return { rot: el.classList.contains('rot'), tf: el.style.transform, ic: ic.style.transform, w: parseFloat(el.style.width), h: parseFloat(el.style.height), l: parseFloat(el.style.left), t: parseFloat(el.style.top), bw: box.width, bh: box.height, hd: tm.hd, mr: tm.rot, compass: !document.getElementById('compassBtn').hidden }; });
    const num = t => parseFloat(/-?[\d.]+/.exec(t || '')?.[0]);
    let a = await st();
    check('지도가 진행 방향 위(회전) 상태로 시작한다', a.rot && a.compass && /rotate\(/.test(a.tf));
    check('지도 방향 = 경로 진행 방향 (A→B 는 북북동 약 27°)', Math.abs(a.mr - 27) < 3, `${a.mr.toFixed(1)}°`);
    check('차 아이콘과 지도는 같은 각도만큼 반대로 돌아 화면에서는 늘 위를 본다', Math.abs(num(a.ic) + num(a.tf)) < 0.01 && Math.abs(num(a.ic) - a.hd) < 0.01, `${a.ic} / ${a.tf} / hd ${a.hd}`);
    /* 어느 각도로 돌아도 화면 네 모서리가 지도 안에 들어온다 */
    const cover = await p.evaluate(() => { const el = document.getElementById('tmap'), D = parseFloat(el.style.width), box = document.querySelector('.navmap').getBoundingClientRect();
      const cx = parseFloat(el.style.left) + D / 2, cy = parseFloat(el.style.top) + D / 2; let bad = 0;
      for (let a = 0; a < 360; a += 5) { const r = a * Math.PI / 180;
        for (const [x, y] of [[0, 0], [box.width, 0], [0, box.height], [box.width, box.height]]) { const dx = x - cx, dy = y - cy, u = dx * Math.cos(r) - dy * Math.sin(r), v = dx * Math.sin(r) + dy * Math.cos(r); if (Math.abs(u) > D / 2 + .5 || Math.abs(v) > D / 2 + .5) bad++; } }
      return { bad, D, cy: cy / box.height }; });
    check('0~360° 어느 방향에서도 화면 모서리가 빈 채로 보이지 않는다', cover.bad === 0, `지도 ${cover.D}px · 차 위치 세로 ${(cover.cy * 100).toFixed(0)}%`);
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

  /* 3. 사고 유형 맞춤 안내 */
  section('사고 유형 맞춤 주의 안내');
  {
    const { ctx, mkPage } = await mkContext(await browser);
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=seg-2023-11650001`); await p.waitForTimeout(1200);
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
    await p.goto(`${B}pages/detail.html?seg=seg-2023-11650001`); await p.waitForTimeout(1000);
    check('구간 상세에 운전 팁이 보인다(가짜 시험 데이터 연결)', (await p.locator('#pntTip').isVisible()) && (await p.textContent('#pntTip')).includes('보행자를 주의하세요'));
    await ctx.close();
  }

  {
    const { ctx, mkPage } = await mkContext(await browser, { pnt: false });
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=seg-2023-11650001`); await p.waitForTimeout(1200);
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
    await p.goto(`${B}pages/detail.html?seg=seg-2023-11650001`); await p.waitForTimeout(1200);
    check('구간 상세: 지도가 맨 위(첫 번째)에 있다', await p.evaluate(() => document.querySelector('main').firstElementChild.id === 'heroMap') && await p.locator('#heroMap').isVisible());
    check('구간 상세: 좌표 대체 카드는 숨는다', await p.locator('#mapView').isHidden());
    await p.goto(`${B}pages/list.html`); await p.waitForTimeout(1200);
    check('위험 구간 목록: 지도에 347곳이 점으로 찍힌다', (await p.evaluate(() => window.__lcalls.circle)) === 347);
    await ctx.close();
  }
  {
    const { ctx, mkPage } = await mkContext(await browser);                       // 지도 라이브러리를 못 불러오는 상황
    const p = await mkPage();
    await p.goto(`${B}pages/detail.html?seg=seg-2023-11650001`); await p.waitForTimeout(1200);
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
    check('오프라인에서도 위험 구간 목록이 열린다', /347/.test(await p.textContent('#resultCount')));
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
    const pages = ['index.html', 'pages/route.html', 'pages/list.html', 'pages/my.html', 'pages/data.html', 'pages/detail.html?seg=seg-2023-11650001', 'pages/report.html', 'pages/signup.html',
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

  section('가입 · 로그인 · 탈퇴 (실제 회원 서버 + DB 와 함께)');
  {
    const port = 35000 + Math.floor(Math.random() * 900);
    const child = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DB: 'sqlite', SQLITE_PATH: ':memory:', APP_SECRET: 'e2e'.repeat(12), RESEND_COOLDOWN_S: '2', DEV_SHOW_CODE: '', NODE_ENV: '', SMTP_HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const codes = () => [...out.matchAll(/제목: \[Safe Drive\] \S+ 인증번호 (\d{6})/g)].map(m => m[1]);
    const nextCode = async n => { for (let i = 0; i < 40 && codes().length <= n; i++) await new Promise(r => setTimeout(r, 100)); return codes()[n]; };
    try {
      for (let i = 0; i < 50 && !out.includes('Safe Drive 서버'); i++) await new Promise(r => setTimeout(r, 100));
      const S = `http://127.0.0.1:${port}/`;
      const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
      const log = { local: [], dir: [], errs: [] }; ALL_LOGS.push(log);
      const p = await ctx.newPage(); p.on('pageerror', e => log.errs.push(`${p.url().split('/').pop()}: ${e.message}`));
      await p.goto(S + 'pages/signup.html'); await p.waitForTimeout(800);
      check('서버가 있으면 개발 모드 안내(메일 미설정)·개인정보 문구·로그인 전환이 보인다', (await p.locator('#modeNote').innerText()).includes('개발 모드') && await p.locator('#privacy').isVisible() && await p.locator('#swapMode').isVisible());
      await p.fill('#nickname', '안전운전'); await p.fill('#email', 'Tester@Example.com'); await p.click('#sendCode');
      const c1 = await nextCode(0);
      check('인증번호는 화면이 아니라 서버(메일 자리)로만 나간다', !!c1 && (await p.locator('.devcode').count()) === 0 && (await p.locator('#sentMsg').innerText()).includes('메일함'));
      check('보낸 직후 재전송 버튼은 잠긴다(60초 간격)', await p.locator('#sendCode').isDisabled() && (await p.locator('#sendCode').innerText()).includes('재전송'));
      await p.fill('#code', c1 === '000000' ? '111111' : '000000'); await p.click('#verify'); await p.waitForTimeout(200);
      check('틀린 번호: 남은 시도 횟수를 알려 준다', (await p.locator('#errMsg').innerText()).includes('4번 더'));
      await p.fill('#code', c1); await p.click('#verify'); await p.waitForTimeout(200);
      check('맞는 번호: 이메일 인증 완료, 가입하기 버튼이 켜진다', await p.locator('#state-verified').isVisible() && await p.locator('#join').isEnabled());
      await p.click('#join'); await p.waitForSelector('#state-join-done.on', { timeout: 4000 });
      const sess = await p.evaluate(() => ({ user: JSON.parse(localStorage.getItem('sd_user')), tk: localStorage.getItem('sd_token') }));
      check('가입하면 로그인 토큰이 이 기기에 저장된다 (이메일은 소문자로 정리)', sess.user.server === true && sess.user.email === 'tester@example.com' && /^[\w-]{40,}$/.test(sess.tk));
      /* 마이 */
      await p.goto(S + 'pages/my.html'); await p.waitForTimeout(800);
      check('마이: 닉네임 · 로그아웃 · 회원 탈퇴 메뉴가 보인다', (await p.locator('#profileName').innerText()).includes('안전운전') && (await p.locator('#profileBtn').innerText()) === '로그아웃' && await p.locator('#withdrawRow').isVisible());
      const me = await p.evaluate(async t => (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).status, sess.tk);
      check('서버가 이 토큰을 알아본다 (GET /api/me)', me === 200);
      /* 로그아웃 → 같은 이메일로 로그인 */
      await p.click('#profileBtn'); await p.click('#lgYes'); await p.waitForTimeout(600);
      const afterOut = await p.evaluate(async t => ({ tk: localStorage.getItem('sd_token'), user: localStorage.getItem('sd_user'), me: (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).status }), sess.tk);
      check('로그아웃하면 이 기기의 정보와 서버의 로그인 기록이 모두 지워진다', afterOut.tk === null && afterOut.user === null && afterOut.me === 401);
      await p.goto(S + 'pages/signup.html?mode=login'); await p.waitForTimeout(800);
      check('로그인 화면: 닉네임 칸과 하단 가입 버튼이 없다', await p.locator('#nickField').isHidden() && await p.locator('.cta-bar').isHidden());
      await p.fill('#email', 'tester@example.com');
      await p.waitForTimeout(2300);                                   // 서버 쪽 재전송 간격(시험에서는 2초)
      await p.click('#sendCode'); const c2 = await nextCode(1);
      await p.fill('#code', c2); await p.click('#verify'); await p.waitForSelector('#state-join-done.on', { timeout: 4000 });
      check('같은 이메일로 인증번호 로그인이 된다', (await p.evaluate(() => JSON.parse(localStorage.getItem('sd_user')).nickname)) === '안전운전');
      /* 없는 계정 */
      await p.evaluate(() => { localStorage.clear(); });
      await p.goto(S + 'pages/signup.html?mode=login'); await p.waitForTimeout(700);
      await p.fill('#email', 'nobody@example.com'); await p.click('#sendCode'); await p.waitForTimeout(500);
      check('가입 안 된 이메일로 로그인하면 안내 문구', (await p.locator('#errMsg').innerText()).includes('가입된 이메일이 아니에요'));
      /* 같은 이메일로 다시 가입 시도 → 이미 가입 */
      await p.goto(S + 'pages/signup.html'); await p.waitForTimeout(600);
      await p.fill('#nickname', '새닉네임'); await p.fill('#email', 'tester@example.com'); await p.click('#sendCode'); await p.waitForTimeout(500);
      check('이미 가입한 이메일로 가입하면 로그인하라고 알려 준다', (await p.locator('#errMsg').innerText()).includes('이미 가입된 이메일'));
      /* 탈퇴 */
      await p.goto(S + 'pages/signup.html?mode=login'); await p.waitForTimeout(700);
      await p.fill('#email', 'tester@example.com'); await p.waitForTimeout(2300); await p.click('#sendCode'); const c3 = await nextCode(2);
      await p.fill('#code', c3); await p.click('#verify'); await p.waitForSelector('#state-join-done.on', { timeout: 4000 });
      const tk3 = await p.evaluate(() => localStorage.getItem('sd_token'));
      await p.goto(S + 'pages/my.html'); await p.waitForTimeout(700);
      await p.click('#withdrawRow'); check('탈퇴 확인 창이 열린다', await p.locator('#withdrawModal.on').count() === 1);
      await p.click('#wdNo'); check('취소하면 닫힌다', await p.locator('#withdrawModal.on').count() === 0);
      await p.click('#withdrawRow'); await p.click('#wdYes'); await p.waitForTimeout(900);
      const gone = await p.evaluate(async t => ({ tk: localStorage.getItem('sd_token'), user: localStorage.getItem('sd_user'), me: (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).status }), tk3);
      check('탈퇴하면 서버 계정이 삭제되고 이 기기도 로그아웃된다', gone.tk === null && gone.user === null && gone.me === 401 && (await p.locator('#profileName').innerText()).includes('비회원'));
      await p.goto(S + 'pages/signup.html'); await p.waitForTimeout(500);
      await p.fill('#nickname', '안전운전'); await p.fill('#email', 'tester@example.com'); await p.waitForTimeout(2300); await p.click('#sendCode'); await p.waitForTimeout(600);
      check('탈퇴 뒤에는 같은 이메일·닉네임으로 다시 가입할 수 있다', (await p.locator('#state-code-sent.on').count()) === 1);
      await ctx.close();
    } finally { child.kill(); }
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
