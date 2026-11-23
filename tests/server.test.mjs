/* server.test.mjs — 회원 서버 자동 점검 (v0.6: 이메일+비밀번호 · 제보/최근 검색 DB 저장 · 계정 유추 방지).  실행: npm run test:server   (Node 22.5 이상: 시험은 내장 SQLite 로 돌려요)
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
const PW = 'Drive2026safe';
const auth = t => ({ Authorization: `Bearer ${t}` });
/* 가입을 끝까지 하고 {token, user} 를 돌려준다 */
async function join(s, email = sig.email, nickname = sig.nickname, password = PW) {
  s.clock.t += 61_000;
  let r = await s.call('POST', '/api/auth/request-code', { email, purpose: 'signup', nickname }); if (r.status !== 200) return r;
  r = await s.call('POST', '/api/auth/verify-code', { email, purpose: 'signup', code: s.codeOf() }); if (r.status !== 200) return r;
  return s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken, password });
}

test('가입 전체 흐름: 인증번호 → 확인 → 비밀번호와 함께 가입 → 내 정보 → 로그아웃', async () => {
  const s = await boot();
  let r = await s.call('POST', '/api/auth/request-code', sig);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.expiresIn, 180);
  assert.equal(r.body.devCode, undefined, '응답에 인증번호가 들어 있으면 안 된다');
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].to, 'kim@example.com', '이메일은 소문자로 정리된다');
  assert.match(s.sent[0].text, /\d{6}/);
  r = await s.call('POST', '/api/auth/verify-code', { email: 'kim@example.com', purpose: 'signup', code: s.codeOf() });
  assert.equal(r.status, 200); assert.ok(r.body.verifyToken);
  r = await s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken, password: PW });
  assert.equal(r.status, 200); assert.match(r.body.user.uid, /^u_[a-z0-9]{12}$/); assert.equal(r.body.user.nickname, '안전운전'); assert.equal(r.body.user.email, 'kim@example.com');
  const token = r.body.token;
  r = await s.call('GET', '/api/me', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200); assert.equal(r.body.user.nickname, '안전운전');
  r = await s.call('POST', '/api/auth/logout', {}, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  r = await s.call('GET', '/api/me', undefined, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 401, '로그아웃한 토큰은 더 못 쓴다');
  await s.close();
});

test('DB 에는 인증번호·세션 토큰·비밀번호가 평문으로 남지 않는다', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig);
  const code = s.codeOf();
  const row = await s.db.get('SELECT code_hash FROM email_codes');
  assert.ok(row.code_hash.length === 64 && !row.code_hash.includes(code));
  let r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code });
  r = await s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken, password: PW });
  const ses = await s.db.get('SELECT token_hash FROM sessions');
  assert.ok(ses.token_hash !== r.body.token && ses.token_hash.length === 64);
  const u = await s.db.get('SELECT password_hash FROM users');
  assert.ok(u.password_hash.startsWith('scrypt$') && !u.password_hash.includes(PW), '비밀번호는 해시로만 저장');
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

test('이미 가입한 이메일로 가입을 시도해도 응답은 똑같고(가입 여부 비공개), 닉네임은 중복 확인', async () => {
  const s = await boot();
  assert.equal((await join(s, 'a@example.com', 'Driver')).status, 200);
  const before = s.sent.length;
  s.clock.t += 61_000;
  const r = await s.call('POST', '/api/auth/request-code', { email: 'a@example.com', purpose: 'signup', nickname: '다른이름' });
  const fresh = await s.call('POST', '/api/auth/request-code', { email: 'new@example.com', purpose: 'signup', nickname: '새사람' });
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.body).sort(), Object.keys(fresh.body).sort(), '가입된 이메일과 새 이메일의 응답 모양이 같다');
  assert.equal(s.sent.length, before + 2, '두 경우 모두 메일이 나간다');
  assert.doesNotMatch(s.sent[before].subject + s.sent[before].text, /\d{6}/, '가입된 이메일에는 번호 대신 안내 메일');
  /* 가짜 인증 기록은 어떤 번호로도 통과하지 못한다 */
  for (let i = 0; i < 3; i++) assert.equal((await s.call('POST', '/api/auth/verify-code', { email: 'a@example.com', purpose: 'signup', code: '123456' })).status, 400);
  /* 대기 시간 · 시간당 횟수도 똑같이 적용된다 */
  assert.equal((await s.call('POST', '/api/auth/request-code', { email: 'a@example.com', purpose: 'signup', nickname: '다른이름' })).body.error, 'cooldown');
  const dup = await s.call('POST', '/api/auth/request-code', { email: 'b@example.com', purpose: 'signup', nickname: 'driver' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error, 'nickname_taken');
  await s.close();
});

test('가입 토큰은 위조·만료·재사용이 안 된다', async () => {
  const s = await boot();
  await s.call('POST', '/api/auth/request-code', sig);
  let r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'signup', code: s.codeOf() });
  const vt = r.body.verifyToken;
  const [body, mac] = vt.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), n: '해커닉' })).toString('base64url') + '.' + mac;
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: forged, password: PW })).status, 400, '내용을 바꾸면 거부');
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: 'abc', password: PW })).status, 400);
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: vt, password: PW })).status, 200);
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: vt, password: PW })).status, 409, '같은 토큰으로 다시 가입 불가');
  s.clock.t += 61_000; await s.call('POST', '/api/auth/request-code', { email: 'z@example.com', purpose: 'signup', nickname: '지각생' });
  r = await s.call('POST', '/api/auth/verify-code', { email: 'z@example.com', purpose: 'signup', code: s.codeOf() });
  s.clock.t += 601_000;
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: r.body.verifyToken, password: PW })).status, 400, '10분 지나면 만료');
  await s.close();
});

test('로그인(이메일+비밀번호): 성공 · 틀린 이유를 구분하지 않음 · 세션 만료 · 탈퇴', async () => {
  const s = await boot();
  assert.equal((await join(s)).status, 200);
  let r = await s.call('POST', '/api/auth/login', { email: 'KIM@example.com', password: PW });
  assert.equal(r.status, 200); assert.ok(r.body.token); assert.equal(r.body.user.nickname, '안전운전');
  const wrong = await s.call('POST', '/api/auth/login', { email: sig.email, password: 'Wrong2026pass' });
  const none = await s.call('POST', '/api/auth/login', { email: 'nobody@example.com', password: PW });
  assert.equal(wrong.status, 401); assert.equal(none.status, 401);
  assert.deepEqual(wrong.body, none.body, '비밀번호가 틀린 것과 없는 이메일은 응답이 완전히 같다');
  assert.equal((await s.call('POST', '/api/auth/login', { email: sig.email, password: '' })).status, 401);
  const t2 = r.body.token;
  s.clock.t += 31 * 86400_000;
  assert.equal((await s.call('GET', '/api/me', undefined, auth(t2))).status, 401, '30일 지나면 세션 만료');
  const t3 = (await s.call('POST', '/api/auth/login', { email: sig.email, password: PW })).body.token;
  r = await s.call('DELETE', '/api/me', {}, auth(t3)); assert.equal(r.status, 403, '비밀번호 없이는 탈퇴 못 한다'); assert.equal(r.body.error, 'bad_password');
  r = await s.call('DELETE', '/api/me', { password: 'Wrong2026pass' }, auth(t3)); assert.equal(r.status, 403);
  r = await s.call('DELETE', '/api/me', { password: PW }, auth(t3)); assert.equal(r.status, 200);
  for (const t of ['users', 'sessions', 'email_codes', 'reports', 'recent_searches']) assert.equal((await s.db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n, 0, `${t} 는 탈퇴하면 비어야 한다`);
  assert.equal((await s.call('GET', '/api/me', undefined, auth(t3))).status, 401);
  await s.close();
});

test('로그인 시도 제한: 같은 이메일 15분에 8번, 막히면 맞는 비밀번호도 거부', async () => {
  const s = await boot();
  await join(s);
  let r;
  for (let i = 0; i < 8; i++) { r = await s.call('POST', '/api/auth/login', { email: sig.email, password: 'Wrong2026pass' }); assert.equal(r.status, 401, `${i + 1}번째`); }
  r = await s.call('POST', '/api/auth/login', { email: sig.email, password: PW });
  assert.equal(r.status, 429); assert.equal(r.body.error, 'rate_login');
  s.clock.t += 16 * 60_000;
  assert.equal((await s.call('POST', '/api/auth/login', { email: sig.email, password: PW })).status, 200, '15분 뒤엔 다시 된다');
  await s.close();
});

test('비밀번호 규칙: 길이 · 영문+숫자 · 흔한 것 · 이메일 앞부분 · 닉네임', async () => {
  const s = await boot();
  s.clock.t += 61_000;
  await s.call('POST', '/api/auth/request-code', { email: 'kimchi@example.com', purpose: 'signup', nickname: '닉네임둘' });
  const vt = (await s.call('POST', '/api/auth/verify-code', { email: 'kimchi@example.com', purpose: 'signup', code: s.codeOf() })).body.verifyToken;
  for (const [pw, why] of [['Ab1', '짧음'], ['a'.repeat(65) + '1', '너무 김'], ['onlyletters', '숫자 없음'], ['1234567890', '영문 없음'], ['password123', '흔함'], ['kimchi2026x', '이메일 앞부분'], ['My닉네임둘2026', '닉네임'], [undefined, '없음']]) {
    const r = await s.call('POST', '/api/auth/signup', { verifyToken: vt, password: pw });
    assert.equal(r.body.error, 'weak_password', `${why}: ${pw}`);          // 약한 비밀번호는 가입 토큰을 소모하지 않는다
  }
  assert.equal((await s.call('POST', '/api/auth/signup', { verifyToken: vt, password: 'Good2026road' })).status, 200);
  await s.close();
});

test('비밀번호 재설정: 이메일 인증 → 새 비밀번호 → 다른 기기 로그인 해제 · 가입 안 된 이메일도 응답이 같다', async () => {
  const s = await boot();
  const oldTok = (await join(s)).body.token;
  s.clock.t += 61_000;
  let r = await s.call('POST', '/api/auth/request-code', { email: sig.email, purpose: 'reset' }); assert.equal(r.status, 200);
  const sentReal = s.sent.length; const code = s.codeOf();
  s.clock.t += 61_000;
  const ghost = await s.call('POST', '/api/auth/request-code', { email: 'ghost@example.com', purpose: 'reset' });
  assert.equal(ghost.status, 200); assert.deepEqual(Object.keys(ghost.body).sort(), Object.keys(r.body).sort()); assert.equal(s.sent.length, sentReal, '없는 이메일에는 메일을 보내지 않지만 응답은 같다');
  assert.equal((await s.call('POST', '/api/auth/verify-code', { email: 'ghost@example.com', purpose: 'reset', code: '123456' })).status, 400);
  r = await s.call('POST', '/api/auth/verify-code', { email: sig.email, purpose: 'reset', code }); assert.equal(r.status, 200);
  assert.equal((await s.call('POST', '/api/auth/reset-password', { verifyToken: r.body.verifyToken, password: 'short' })).body.error, 'weak_password');
  const done = await s.call('POST', '/api/auth/reset-password', { verifyToken: r.body.verifyToken, password: 'Brand2026new' });
  assert.equal(done.status, 200); assert.ok(done.body.token);
  assert.equal((await s.call('GET', '/api/me', undefined, auth(oldTok))).status, 401, '이전 로그인은 모두 풀린다');
  assert.equal((await s.call('POST', '/api/auth/login', { email: sig.email, password: PW })).status, 401);
  assert.equal((await s.call('POST', '/api/auth/login', { email: sig.email, password: 'Brand2026new' })).status, 200);
  /* 가입 토큰으로는 재설정이 안 된다 */
  s.clock.t += 61_000; await s.call('POST', '/api/auth/request-code', { email: 'x@example.com', purpose: 'signup', nickname: '엑스' });
  const sv = await s.call('POST', '/api/auth/verify-code', { email: 'x@example.com', purpose: 'signup', code: s.codeOf() });
  assert.equal((await s.call('POST', '/api/auth/reset-password', { verifyToken: sv.body.verifyToken, password: 'Brand2026new' })).status, 400);
  await s.close();
});

test('특정인 유추 방지: 비밀번호 해시는 사람마다 다르고, 밖으로 나가는 id 는 순번이 아니다', async () => {
  const s = await boot();
  const a = await join(s, 'a@example.com', '가나다', PW), b = await join(s, 'b@example.com', '라마바', PW);
  const rows = await s.db.all('SELECT password_hash, public_id, id FROM users ORDER BY id');
  assert.notEqual(rows[0].password_hash, rows[1].password_hash, '같은 비밀번호여도 해시가 다르다(salt)');
  assert.notEqual(rows[0].public_id, rows[1].public_id);
  assert.ok(rows.every(r => /^u_[a-z0-9]{12}$/.test(r.public_id)));
  assert.equal(a.body.user.uid, rows[0].public_id);
  const text = JSON.stringify([a.body, b.body, (await s.call('GET', '/api/me', undefined, auth(a.body.token))).body]);
  assert.ok(!text.includes('"id"'), '응답에 안쪽 순번 id 가 없다');
  await s.close();
});

test('옛(v0.5) DB 에서 올라오기: 비밀번호 없는 회원에게 공개 id 를 채우고, 비밀번호 찾기로 정할 수 있다', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const fs = await import('node:fs'), os = await import('node:os');
  const file = path.join(os.tmpdir(), `sd-old-${process.pid}.sqlite`); fs.rmSync(file, { force: true });
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, nickname_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_login_at INTEGER);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    INSERT INTO users (email, nickname, nickname_key, created_at) VALUES ('old@example.com', '옛회원', '옛회원', 1);`);
  old.close();
  const db = await openDb({ DB: 'sqlite', SQLITE_PATH: file });
  const u = await db.get('SELECT public_id, password_hash FROM users');
  assert.match(u.public_id, /^u_[a-z0-9]{12}$/); assert.equal(u.password_hash, null);
  const app = createApp({ db, mailer: { kind: 'fake', async send() {} }, cfg: { APP_SECRET: 'x'.repeat(32), QUIET: true } });
  const srv = http.createServer((q, r) => app.handle(q, r)); await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email: 'old@example.com', password: PW }) });
  assert.equal(r.status, 401, '비밀번호가 없는 옛 계정은 로그인 실패(안내 문구가 비밀번호 찾기를 알려 준다)');
  assert.match((await r.json()).message, /비밀번호 찾기/);
  await new Promise(ok => srv.close(ok)); await db.close(); fs.rmSync(file, { force: true });
  const again = await openDb({ DB: 'sqlite', SQLITE_PATH: ':memory:' }); await again.migrate(); await again.close();       // 두 번 올려도 오류가 없다
});

test('제보: 내 계정에만 저장·수정·삭제, 남의 제보는 건드릴 수 없다', async () => {
  const s = await boot();
  const a = (await join(s, 'a@example.com', '가나다')).body.token, b = (await join(s, 'b@example.com', '라마바')).body.token;
  assert.equal((await s.call('POST', '/api/reports', { roadName: '시험로', address: '서울 시험구 시험동', riskLevel: 3 })).status, 401, '로그인 없이는 못 쓴다');
  let r = await s.call('POST', '/api/reports', { roadName: '  시험로  ', address: '서울특별시 시험구 시험동', riskLevel: 3, accidentCount: '' }, auth(a));
  assert.equal(r.status, 200); const id = r.body.report.segmentId;
  assert.match(id, /^user-[a-z0-9]{12}$/); assert.equal(r.body.report.roadName, '시험로'); assert.equal(r.body.report.accidentCount, null);
  assert.equal((await s.call('POST', '/api/reports', { roadName: '가', address: '서울 시험구', riskLevel: 3 }, auth(a))).body.error, 'bad_report');
  assert.equal((await s.call('POST', '/api/reports', { roadName: '시험로', address: '서울 시험구', riskLevel: 9 }, auth(a))).status, 400);
  assert.equal((await s.call('POST', '/api/reports', { roadName: '시험로', address: '서울 시험구', riskLevel: 2, accidentCount: -1 }, auth(a))).status, 400);
  r = await s.call('PUT', `/api/reports/${id}`, { roadName: '바꾼로', address: '서울특별시 바꾼구', riskLevel: 4, accidentCount: 12 }, auth(a));
  assert.equal(r.status, 200); assert.equal(r.body.report.riskLevel, 4); assert.ok(r.body.report.updatedAt);
  assert.equal((await s.call('PUT', `/api/reports/${id}`, { roadName: '해킹', address: '서울특별시 해킹구', riskLevel: 1 }, auth(b))).status, 404, '남의 제보 수정은 "없음"');
  assert.equal((await s.call('DELETE', `/api/reports/${id}`, undefined, auth(b))).status, 404);
  assert.equal((await s.call('GET', '/api/me/data', undefined, auth(b))).body.reports.length, 0, '남의 제보는 목록에 안 나온다');
  r = await s.call('GET', '/api/me/data', undefined, auth(a)); assert.equal(r.body.reports.length, 1); assert.equal(r.body.reports[0].roadName, '바꾼로');
  assert.equal((await s.call('DELETE', `/api/reports/${id}`, undefined, auth(a))).status, 200);
  assert.equal((await s.call('GET', '/api/me/data', undefined, auth(a))).body.reports.length, 0);
  assert.equal((await s.call('GET', '/api/reports/' + "x'; DROP TABLE reports;--")).status, 404);
  await s.close();
});

test('제보 개수 제한(200건)과 주소창 id 모양 검사', async () => {
  const s = await boot({ cfg: { REPORT_MAX: 3 } });
  const a = (await join(s)).body.token;
  for (let i = 0; i < 3; i++) assert.equal((await s.call('POST', '/api/reports', { roadName: `도로${i}번`, address: '서울 시험구 시험동', riskLevel: 1 }, auth(a))).status, 200);
  const r = await s.call('POST', '/api/reports', { roadName: '넘침로', address: '서울 시험구 시험동', riskLevel: 1 }, auth(a));
  assert.equal(r.status, 429); assert.equal(r.body.error, 'quota');
  await s.close();
});

test('최근 검색: 같은 검색은 맨 위로, 사람마다 10건, 내 것만', async () => {
  const s = await boot();
  const a = (await join(s, 'a@example.com', '가나다')).body.token, b = (await join(s, 'b@example.com', '라마바')).body.token;
  const add = async (body, tok = a) => { s.clock.t += 1000; return s.call('POST', '/api/recents', body, auth(tok)); };
  for (let i = 0; i < 12; i++) await add({ kind: 'keyword', q: `검색${i}` });
  await add({ kind: 'route', origin: '서울역', destination: '강남역' });
  await add({ kind: 'keyword', q: '검색11' });                                     // 같은 검색 → 맨 위로(중복 없이)
  await add({ kind: 'keyword', q: '비공개' }, b);
  let d = (await s.call('GET', '/api/me/data', undefined, auth(a))).body.recents;
  assert.equal(d.length, 10); assert.equal(d[0].q, '검색11'); assert.equal(d.filter(x => x.q === '검색11').length, 1);
  assert.ok(d.some(x => x.kind === 'route' && x.origin === '서울역' && x.destination === '강남역'));
  assert.ok(d.every(x => x.q !== '검색0' && x.q !== '비공개'), '오래된 것은 밀려나고 남의 것은 없다');
  assert.equal((await add({ kind: 'keyword', q: '   ' })).status, 400);
  assert.equal((await add({ kind: 'route', origin: '서울역' })).status, 400);
  const id = d[1].id;
  assert.equal((await s.call('DELETE', `/api/recents/${id}`, undefined, auth(b))).status, 200, '남의 id 는 조용히 아무 일도 안 한다');
  assert.equal((await s.call('GET', '/api/me/data', undefined, auth(a))).body.recents.length, 10);
  await s.call('DELETE', `/api/recents/${id}`, undefined, auth(a));
  assert.equal((await s.call('GET', '/api/me/data', undefined, auth(a))).body.recents.length, 9);
  await s.call('DELETE', '/api/recents', undefined, auth(a));
  assert.equal((await s.call('GET', '/api/me/data', undefined, auth(a))).body.recents.length, 0);
  assert.equal((await s.call('GET', '/api/me/data', undefined, auth(b))).body.recents.length, 1);
  await s.close();
});

test('기기에 있던 제보·최근 검색을 계정으로 올리기(import): 잘못된 항목은 건너뛴다', async () => {
  const s = await boot();
  const a = (await join(s)).body.token;
  const r = await s.call('POST', '/api/me/import', {
    reports: [{ roadName: '올린로', address: '서울특별시 올린구 올린동', riskLevel: 2, accidentCount: 5 }, { roadName: '', address: 'x', riskLevel: 7 }, null],
    recents: [{ kind: 'keyword', q: '강남' }, { kind: 'route', origin: 'A', destination: 'B' }, { kind: 'keyword', q: '' }]
  }, auth(a));
  assert.equal(r.status, 200); assert.deepEqual([r.body.reports, r.body.recents, r.body.skipped], [1, 2, 3]);
  const d = (await s.call('GET', '/api/me/data', undefined, auth(a))).body;
  assert.equal(d.reports.length, 1); assert.equal(d.recents.length, 2);
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
