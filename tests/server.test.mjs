/* server.test.mjs — 회원 서버 자동 점검.  실행: npm run test:server   (Node 22.5 이상: 시험은 내장 SQLite 로 돌려요)
   진짜 메일·진짜 MySQL 은 쓰지 않는다 — 메일은 가짜 발송기, DB 는 메모리 SQLite. 같은 SQL 을 MySQL 도 쓰지만 MySQL 쪽은 여기서 확인하지 못한다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

async function boot(extra = {}) {
  const db = await openDb({ DB: 'sqlite', SQLITE_PATH: ':memory:' });
  const sent = [];
  const mailer = { kind: extra.mailKind || 'fake', async send(m) { if (extra.failMail) throw new Error('smtp down'); sent.push(m); } };
  const clock = { t: 1_800_000_000_000 };
  const app = createApp({ db, mailer, cfg: { APP_SECRET: 'x'.repeat(32), now: () => clock.t, QUIET: true, CORS_ORIGINS: 'https://app.example', ...extra.cfg } });
  const srv = http.createServer((q, r) => app.handle(q, r));
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j, headers: r.headers };
  };
  const codeOf = () => /(\d{6})/.exec(sent.at(-1).subject)[1];
  return { db, sent, clock, call, codeOf, base, close: async () => { await new Promise(ok => srv.close(ok)); await db.close(); } };
}
const sig = { email: 'Kim@Example.com', purpose: 'signup', nickname: '안전운전' };

test('가입 전체 흐름: 인증번호 → 확인 → 가입 → 내 정보 → 로그아웃', async () => {
  const s = await boot();
  let r = await s.call('POST', '/api/auth/request-code', sig);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.expiresIn, 180);
  assert.equal(r.body.devCode, undefined, '응답에 인증번호가 들어 있으면 안 된다');
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].to, 'kim@example.com', '이메일은 소문자로 정리된다');
  assert.match(s.sent[0].text, /\d{6}/);
  r = await s.call('POST', '/api/auth/verify-code', { email: 'kim@example.com', purpose: 'signup', code: s.codeOf() });
  assert.equal(r.status, 200); assert.ok(r.body.verifyToken);
  r = await s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken });
  assert.equal(r.status, 200); assert.deepEqual(r.body.user, { nickname: '안전운전', email: 'kim@example.com' });
  const token = r.body.token;
  r = await s.call('GET', '/api/me', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200); assert.equal(r.body.user.nickname, '안전운전');
  r = await s.call('POST', '/api/auth/logout', {}, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  r = await s.call('GET', '/api/me', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 401, '로그아웃한 토큰은 더 못 쓴다');
  await s.close();
});

test('DB 에는 인증번호·세션 토큰이 평문으로 남지 않는다', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig);
  const code = s.codeOf();
  const row = await s.db.get('SELECT code_hash FROM email_codes');
  assert.ok(row.code_hash.length === 64 && !row.code_hash.includes(code));
  let r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code });
  r = await s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken });
  const ses = await s.db.get('SELECT token_hash FROM sessions');
  assert.ok(ses.token_hash !== r.body.token && ses.token_hash.length === 64);
  await s.close();
});

test('틀린 번호: 남은 횟수 안내, 5번째 이후엔 번호가 맞아도 막힌다', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig);
  const good = s.codeOf(), bad = good === '000000' ? '111111' : '000000';
  let r;
  for (let i = 1; i <= 4; i++) { r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: bad }); assert.equal(r.status, 400); assert.equal(r.body.error, 'wrong_code'); assert.equal(r.body.attemptsLeft, 5 - i); }
  r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: bad });
  assert.equal(r.body.attemptsLeft, 0);
  r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: good });
  assert.equal(r.status, 429); assert.equal(r.body.error, 'too_many');
  await s.close();
});

test('3분이 지나면 번호가 만료된다', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig);
  s.clock.t += 181_000;
  const r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: s.codeOf() });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'expired');
  await s.close();
});

test('번호는 한 번만 쓸 수 있고, 다시 받으면 이전 번호는 무효', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig); const first = s.codeOf();
  s.clock.t += 61_000;
  await s.call('POST', '/api/auth/request-code', sig); const second = s.codeOf();
  if (first !== second) { const r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: first }); assert.equal(r.status, 400, '이전 번호는 안 된다'); }
  let r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: second });
  if (r.status !== 200) { // 위에서 이전 번호를 시도하며 횟수가 올라갔을 수 있으니 새로 받아 확인
    s.clock.t += 61_000; await s.call('POST', '/api/auth/request-code', sig); r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: s.codeOf() });
  }
  assert.equal(r.status, 200);
  const again = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: s.codeOf() });
  assert.equal(again.status, 400, '이미 쓴 번호는 다시 못 쓴다');
  await s.close();
});

test('재전송은 60초 간격, 이메일당 1시간 5번까지', async () => {
  const s = await boot({ cfg: { REQS_PER_IP_HOUR: 1000 } });
  let r = await s.call('POST', '/api/auth/request-code', sig); assert.equal(r.status, 200);
  r = await s.call('POST', '/api/auth/request-code', sig); assert.equal(r.status, 429); assert.equal(r.body.error, 'cooldown'); assert.ok(r.body.retryAfter > 0 && r.body.retryAfter <= 60);
  for (let i = 0; i < 4; i++) { s.clock.t += 61_000; r = await s.call('POST', '/api/auth/request-code', sig); assert.equal(r.status, 200, `${i + 2}번째`); }
  s.clock.t += 61_000; r = await s.call('POST', '/api/auth/request-code', sig);
  assert.equal(r.status, 429); assert.equal(r.body.error, 'rate_email');
  assert.equal(s.sent.length, 5, '막힌 요청은 메일을 보내지 않는다');
  await s.close();
});

test('같은 IP 가 시간당 20번을 넘으면 막힌다 (서로 다른 이메일이어도)', async () => {
  const s = await boot();
  let last;
  for (let i = 0; i < 21; i++) last = await s.call('POST', '/api/auth/request-code', { email: `u${i}@example.com`, purpose: 'signup', nickname: `사용자${i}` });
  assert.equal(last.status, 429); assert.equal(last.body.error, 'rate_ip');
  assert.equal(s.sent.length, 20);
  await s.close();
});

test('중복: 이미 가입한 이메일 · 이미 쓰는 닉네임(대소문자 무시)', async () => {
  const s = await boot();
  const join = async (email, nickname) => {
    s.clock.t += 61_000;
    let r = await s.call('POST', '/api/auth/request-code', { email, purpose: 'signup', nickname }); if (r.status !== 200) return r;
    r = await s.call('POST', '/api/auth/verify-code', { email, purpose: 'signup', code: s.codeOf() });
    return s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken });
  };
  assert.equal((await join('a@example.com', 'Driver')).status, 200);
  let r = await join('a@example.com', '다른이름'); assert.equal(r.status, 409); assert.equal(r.body.error, 'email_taken');
  r = await join('b@example.com', 'driver'); assert.equal(r.status, 409); assert.equal(r.body.error, 'nickname_taken');
  assert.equal((await join('b@example.com', '두번째')).status, 200);
  await s.close();
});

test('가입 토큰은 위조·만료·재사용이 안 된다', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig);
  let r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: s.codeOf() });
  const vt = r.body.verifyToken;
  const [body, mac] = vt.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), n: '해커닉' })).toString('base64url') + '.' + mac;
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: forged })).status, 400, '내용을 바꾸면 거부');
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: 'abc' })).status, 400);
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: vt })).status, 200);
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: vt })).status, 409, '같은 토큰으로 다시 가입 불가');
  s.clock.t += 61_000; await s.call('POST', '/api/auth/request-code', { email: 'z@example.com', purpose: 'signup', nickname: '지각생' });
  r = await s.call('POST', '/api/auth/verify-code', { email: 'z@example.com', purpose: 'signup', code: s.codeOf() });
  s.clock.t += 601_000;
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken })).status, 400, '10분 지나면 만료');
  await s.close();
});

test('로그인(인증번호) · 없는 계정 · 세션 만료 · 탈퇴', async () => {
  const s = await boot();
  const joinFlow = async () => { await s.call('POST', '/api/auth/request-code', sig); let r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: s.codeOf() }); return s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken }); };
  const j = await joinFlow(); assert.equal(j.status, 200);
  let r = await s.call('POST', '/api/auth/request-code', { email: 'nobody@example.com', purpose: 'login' });
  assert.equal(r.status, 404); assert.equal(r.body.error, 'no_account');
  s.clock.t += 61_000;
  r = await s.call('POST', '/api/auth/request-code', { email: sig.email, purpose: 'login' }); assert.equal(r.status, 200);
  r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'login', code: s.codeOf() });
  assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.user.nickname, '안전운전');
  const t2 = r.body.token;
  s.clock.t += 31 * 86400_000;
  assert.equal((await s.call('GET', '/api/me', undefined, { Authorization: `Bearer ${t2}` })).status, 401, '30일 지나면 세션 만료');
  s.clock.t += 61_000; await s.call('POST', '/api/auth/request-code', { email: sig.email, purpose: 'login' });
  r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'login', code: s.codeOf() });
  const t3 = r.body.token;
  r = await s.call('DELETE', '/api/me', undefined, { Authorization: `Bearer ${t3}` }); assert.equal(r.status, 200);
  assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM users')).n, 0);
  assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM sessions')).n, 0);
  assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM email_codes')).n, 0, '탈퇴하면 인증 기록도 지운다');
  assert.equal((await s.call('GET', '/api/me', undefined, { Authorization: `Bearer ${t3}` })).status, 401);
  await s.close();
});

test('입력 검사: 이메일·닉네임·번호 형식, 잘못된 JSON, 너무 큰 요청', async () => {
  const s = await boot();
  assert.equal((await s.call('POST', '/api/auth/request-code', { ...sig, email: 'not-an-email' })).body.error, 'bad_email');
  assert.equal((await s.call('POST', '/api/auth/request-code', { ...sig, nickname: 'a' })).body.error, 'bad_nickname');
  assert.equal((await s.call('POST', '/api/auth/request-code', { ...sig, nickname: '<script>' })).body.error, 'bad_nickname');
  assert.equal((await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: '12ab56' })).body.error, 'bad_code');
  assert.equal((await s.call('POST', '/api/auth/request-code', '{깨진 json')).body.error, 'bad_json');
  assert.equal((await s.call('POST', '/api/auth/request-code', { ...sig, pad: 'x'.repeat(20000) })).status, 413);
  assert.equal((await s.call('GET', '/api/없는주소')).status, 404);
  assert.equal(s.sent.length, 0);
  await s.close();
});

test('메일 발송에 실패하면 502, 그 번호는 쓸 수 없다', async () => {
  const s = await boot({ failMail: true });
  const r = await s.call('POST', '/api/auth/request-code', sig);
  assert.equal(r.status, 502); assert.equal(r.body.error, 'mail_failed');
  assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM email_codes WHERE used_at IS NULL')).n, 0);
  await s.close();
});

test('개발용 DEV_SHOW_CODE 는 메일 미설정(console)일 때만 번호를 응답에 싣는다', async () => {
  let s = await boot({ mailKind: 'console', cfg: { DEV_SHOW_CODE: '1' } });
  let r = await s.call('POST', '/api/auth/request-code', sig); assert.match(r.body.devCode, /^\d{6}$/); await s.close();
  s = await boot({ mailKind: 'smtp', cfg: { DEV_SHOW_CODE: '1' } });
  r = await s.call('POST', '/api/auth/request-code', sig); assert.equal(r.body.devCode, undefined, '진짜 메일을 보내는 서버에서는 절대 싣지 않는다'); await s.close();
});

test('CORS: 허용한 주소에만 열어 준다 · 미리 확인(OPTIONS) 응답', async () => {
  const s = await boot();
  let r = await s.call('OPTIONS', '/api/auth/request-code', undefined, { Origin: 'https://app.example' });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://app.example');
  r = await s.call('GET', '/api/health', undefined, { Origin: 'https://evil.example' });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await s.call('GET', '/api/health');
  assert.equal(r.status, 200); assert.equal(r.body.service, 'safe-drive'); assert.equal(r.body.db, 'sqlite');
  await s.close();
});

test('세션 토큰 형식이 아니면 DB 를 부르지 않고 401', async () => {
  const s = await boot();
  for (const h of [{}, { Authorization: 'Bearer' }, { Authorization: 'Bearer short' }, { Authorization: "Bearer ' OR 1=1 --aaaaaaaaaaaaaaaaaaaa" }])
    assert.equal((await s.call('GET', '/api/me', undefined, h)).status, 401);
  await s.close();
});

test('SQL 주입 시도는 그냥 문자열로 다뤄진다 (닉네임 규칙에서 막히고, 이메일은 값으로만 들어간다)', async () => {
  const s = await boot();
  assert.equal((await s.call('POST', '/api/auth/request-code', { email: "a@b.co", purpose: 'signup', nickname: "x'); DROP TABLE users;--" })).body.error, 'bad_nickname');
  const r = await s.call('POST', '/api/auth/request-code', { email: "o'brien@example.com", purpose: 'signup', nickname: '정상닉' });
  assert.equal(r.status, 200);
  assert.equal((await s.db.get('SELECT COUNT(*) AS n FROM users')).n, 0);
  await s.close();
});

test('서버 실행 파일(index.js): 설정 없이 켜지고, 메일 대신 터미널에 번호를 찍고, 앱 화면도 같은 주소로 내보낸다', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = 34000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['--no-warnings', path.join(root, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DB: 'sqlite', SQLITE_PATH: ':memory:', APP_SECRET: 'y'.repeat(32), DEV_SHOW_CODE: '1', NODE_ENV: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 50 && !out.includes('Safe Drive 서버'); i++) await new Promise(ok => setTimeout(ok, 100));
    assert.ok(out.includes('Safe Drive 서버'), out);
    const B = `http://127.0.0.1:${port}`;
    assert.equal((await (await fetch(B + '/api/health')).json()).service, 'safe-drive');
    const home = await fetch(B + '/'); assert.equal(home.status, 200); assert.match(await home.text(), /Safe Drive/);
    for (const p of ['/server/.env.example', '/server/index.js', '/tests/e2e.mjs', '/node_modules/', '/.git/config', '/..%2fserver%2findex.js', '/%2e%2e/server/index.js'])
      assert.notEqual((await fetch(B + p)).status, 200, `${p} 는 내보내면 안 된다`);
    const r = await (await fetch(B + '/api/auth/request-code', { method: 'POST', body: JSON.stringify({ email: 'me@example.com', purpose: 'signup', nickname: '테스터' }) })).json();
    assert.match(r.devCode, /^\d{6}$/);
    assert.ok(out.includes('메일 미발송') && out.includes(r.devCode), '터미널에 번호가 찍혀야 한다');
  } finally { child.kill(); }
});
