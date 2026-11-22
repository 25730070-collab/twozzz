/* e2e.mjs — Safe Drive 자동 점검. 실행: npm test  (설명은 tests/README.md)
   카카오 길찾기·장소 검색과 Leaflet 은 가짜로 대신한다. 키는 필요 없다. */
import { chromium } from 'playwright';
import http from 'node:http';
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
async function mkContext(browser, { stub = false, width = 393, keyOk = true, dirStatus = 200, geo = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 852 }, ...(geo ? { permissions: ['geolocation'], geolocation: { latitude: 37.5547, longitude: 126.9707 } } : {}) });
  const log = { local: [], dir: [], errs: [] }; ALL_LOGS.push(log);
  await ctx.route('**/js/config.local.js', r => r.fulfill({ contentType: 'text/javascript', body: keyOk ? "CONFIG.KAKAO_REST_KEY = 'TEST_KEY_NOT_REAL';" : '' }));
  await ctx.route('**/data/pntfr_points.json', r => r.fulfill({ contentType: 'application/json', body: fs.readFileSync(path.join(FX, 'pntfr_points.json')) }));
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
    check('구간 상세에 운전 팁이 보인다(가짜 시험 데이터 연결)', (await p.locator('#pntTip').isVisible()) && (await p.textContent('#pntTip')).includes('보행자를 주의하세요'));
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
  section('종합');
  const errs = ALL_LOGS.flatMap(l => l.errs);
  check('모든 시험 동안 자바스크립트 오류가 없다', errs.length === 0, errs.slice(0, 3).join(' / '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
