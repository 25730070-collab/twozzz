/* app.js — Safe Drive 서버 (Node 내장 http 만 사용, 프레임워크 없음)  v0.6
   로그인: 이메일 + 비밀번호. 가입과 비밀번호 재설정은 이메일 인증번호로 이메일 주인임을 확인한다.

   POST   /api/auth/request-code   {email, purpose:'signup'|'reset', nickname?}  → 인증번호 메일 (가입 여부와 상관없이 응답이 같다)
   POST   /api/auth/verify-code    {email, purpose, code}                         → {verifyToken}
   POST   /api/auth/signup         {verifyToken, password}                        → {token,user}
   POST   /api/auth/login          {email, password}                              → {token,user}   (틀린 이유를 구분해 알려 주지 않는다)
   POST   /api/auth/reset-password {verifyToken, password}                        → {token,user}   (다른 기기 로그인은 모두 풀린다)
   GET    /api/me · POST /api/auth/logout · DELETE /api/me {password}             → 내 정보 · 로그아웃 · 탈퇴(제보·검색 기록까지 삭제)
   GET · DELETE /api/me/data                                                      → {reports, recents} (이 계정 것만) · 모두 삭제
   POST   /api/reports · PUT /api/reports/:id · DELETE /api/reports/:id           → 내 제보
   POST   /api/recents · DELETE /api/recents/:id · DELETE /api/recents            → 최근 검색 (사람마다 10건)
   POST   /api/me/import           {reports, recents}                             → 기기에 있던 것을 계정으로 올리기
   GET    /api/health                                                             → 연결 확인 (프런트가 서버 유무를 알아본다)

   특정인을 알아낼 수 없게: 비밀번호는 scrypt+사람별 salt 해시 · 가입 여부가 응답/대기 시간/메일에 드러나지 않음 · 로그인 실패 이유 비공개 ·
   로그인 시도 제한(이메일 15분 8번, IP 15분 30번) · 밖으로 나가는 id 는 무작위 문자열(순번 비공개) · 남의 제보는 '없음'과 똑같이 답함 ·
   인증번호·세션 토큰은 해시로만 저장 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256, hmacHex, safeEqual, newCode, newToken, sign, unsign, hashPassword, verifyPassword, dummyVerify, passwordProblem, newPublicId } from './auth.js';
import { isDuplicate } from './db.js';

class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICK_RE = /^[가-힣A-Za-z0-9]{2,10}$/;
const normEmail = s => String(s ?? '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && EMAIL_RE.test(e) && !/[\u0000-\u001f]/.test(e);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const NO_STATIC = new Set(['server', 'tests', 'node_modules', 'tools']);

function codeMail(code, purpose, ttlMin) {
  const what = purpose === 'reset' ? '비밀번호 재설정' : '회원가입';
  return {
    subject: `[Safe Drive] ${what} 인증번호 ${code}`,
    text: `Safe Drive ${what} 인증번호: ${code}\n\n${ttlMin}분 안에 입력해 주세요.\n본인이 요청하지 않았다면 이 메일을 무시하셔도 돼요. 이 번호는 다른 사람에게 알려 주지 마세요.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Safe Drive ${what} 인증번호</p>`
      + `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>`
      + `<p style="color:#5b6560;font-size:13px">${ttlMin}분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시하셔도 돼요.</p></div>`
  };
}

/* 이미 가입된 이메일로 가입을 시도했을 때 보내는 안내 (번호는 담지 않는다) */
const existsMail = () => ({
  subject: '[Safe Drive] 이미 가입된 이메일이에요',
  text: 'Safe Drive 에 이 이메일로 이미 가입돼 있어요. 로그인하거나, 비밀번호가 기억나지 않으면 로그인 화면의 "비밀번호 찾기"를 써 주세요.\n본인이 요청하지 않았다면 이 메일을 무시하셔도 돼요.',
  html: '<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Safe Drive 에 이 이메일로 이미 가입돼 있어요.</p><p style="color:#5b6560;font-size:13px">로그인하거나, 비밀번호가 기억나지 않으면 로그인 화면의 "비밀번호 찾기"를 써 주세요. 본인이 요청하지 않았다면 이 메일을 무시하셔도 돼요.</p></div>'
});

/* 같은 키가 일정 시간 안에 몇 번 왔는지 (메모리). 서버가 여러 대면 DB·Redis 로 옮겨야 한다 */
function makeLimiter(max, windowMs, now) {
  const hits = new Map();
  return key => {
    const t = now(), arr = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(t); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k);
    return true;
  };
}

export function createApp({ db, mailer, cfg = {} }) {
  const C = {
    CODE_TTL_S: 180, RESEND_COOLDOWN_S: 60, MAX_ATTEMPTS: 5, CODES_PER_EMAIL_HOUR: 5, REQS_PER_IP_HOUR: 20,
    SESSION_DAYS: 30, VERIFY_TOKEN_TTL_S: 600, BODY_LIMIT: 10_000, LOGIN_PER_EMAIL_15M: 8, LOGIN_PER_IP_15M: 30, REPORT_MAX: 200, RECENT_MAX: 10,
    ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== ''))
  };
  const num = k => Number(C[k]);
  const now = () => (typeof C.now === 'function' ? C.now() : Date.now());
  const secret = C.APP_SECRET;
  if (!secret || String(secret).length < 16) throw new Error('APP_SECRET 이 없거나 너무 짧아요(16자 이상)');
  const origins = new Set(String(C.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
  const ipLimit = makeLimiter(num('REQS_PER_IP_HOUR'), 3600_000, now);
  const loginIp = makeLimiter(num('LOGIN_PER_IP_15M'), 900_000, now), loginEmail = makeLimiter(num('LOGIN_PER_EMAIL_15M'), 900_000, now);
  const showDevCode = String(C.DEV_SHOW_CODE) === '1' && mailer.kind === 'console';     // 진짜 메일을 보내는 서버에서는 절대 번호를 응답에 싣지 않는다

  const clientIp = req => {
    if (String(C.TRUST_PROXY) === '1') { const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (xf.length) return xf[xf.length - 1]; }
    return req.socket.remoteAddress || 'unknown';
  };
  const publicUser = u => ({ uid: u.public_id, nickname: u.nickname, email: u.email });

  async function readJson(req, limit = num('BODY_LIMIT')) {
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'too_large', '요청이 너무 커요');
      chunks.push(c);
    }
    if (!size) return {};
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
    throw new HttpError(400, 'bad_json', '요청 형식이 맞지 않아요');
  }

  async function createSession(userId) {
    const token = newToken(), t = now(), exp = t + num('SESSION_DAYS') * 86400_000;
    await db.run('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', [userId, sha256(token), t, exp]);
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [t, userId]);
    return { token, expiresAt: exp };
  }

  async function authed(req) {
    const m = /^Bearer\s+([\w-]{20,100})$/.exec(String(req.headers.authorization || ''));
    if (!m) throw new HttpError(401, 'unauthorized', '로그인이 필요해요');
    const row = await db.get('SELECT u.id AS id, u.public_id AS public_id, u.email AS email, u.nickname AS nickname, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha256(m[1])]);
    if (!row || Number(row.expires_at) <= now()) throw new HttpError(401, 'unauthorized', '로그인이 만료됐어요. 다시 로그인해 주세요');
    return { ...row, tokenHash: sha256(m[1]) };
  }

  /* ---------- 인증번호 보내기 (가입 · 비밀번호 재설정) ----------
     가입된 이메일인지 아닌지가 응답·메일 횟수·대기 시간에 드러나면 "이 사람이 가입했나"를 알아낼 수 있다.
     그래서 어느 쪽이든 응답은 똑같이 ok 이고, 인증 기록도 똑같이 남긴다 (가입된 이메일로 가입을 시도하면 번호 대신 '이미 가입돼 있어요' 안내 메일,
     가입 안 된 이메일로 재설정을 요청하면 메일을 보내지 않는다). */
  async function requestCode(req) {
    const b = await readJson(req);
    const email = normEmail(b.email), purpose = b.purpose === 'reset' ? 'reset' : 'signup';
    if (!validEmail(email)) throw new HttpError(400, 'bad_email', '이메일 형식이 맞지 않아요');
    let nickname = null;
    if (purpose === 'signup') {
      nickname = String(b.nickname ?? '').trim();
      if (!NICK_RE.test(nickname)) throw new HttpError(400, 'bad_nickname', '닉네임은 한글·영문·숫자 2~10자예요');
    }
    if (!ipLimit(clientIp(req))) throw new HttpError(429, 'rate_ip', '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요');

    const t = now();
    const user = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (purpose === 'signup' && !user && await db.get('SELECT id FROM users WHERE nickname_key = ?', [nickname.toLowerCase()]))
      throw new HttpError(409, 'nickname_taken', '이미 쓰고 있는 닉네임이에요');          // 닉네임은 화면에 보이는 이름이라 중복 여부를 알려 줘도 된다

    const last = await db.get('SELECT created_at FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1', [email]);
    if (last) {
      const wait = Math.ceil((Number(last.created_at) + num('RESEND_COOLDOWN_S') * 1000 - t) / 1000);
      if (wait > 0) throw new HttpError(429, 'cooldown', `${wait}초 뒤에 다시 받을 수 있어요`, { retryAfter: wait });
    }
    const cnt = await db.get('SELECT COUNT(*) AS n FROM email_codes WHERE email = ? AND created_at > ?', [email, t - 3600_000]);
    if (Number(cnt.n) >= num('CODES_PER_EMAIL_HOUR')) throw new HttpError(429, 'rate_email', '이 이메일로는 1시간에 인증번호를 5번까지 받을 수 있어요. 나중에 다시 시도해 주세요');

    await db.run('DELETE FROM email_codes WHERE expires_at < ?', [t - 86400_000]);
    await db.run('DELETE FROM sessions WHERE expires_at < ?', [t]);
    await db.run('UPDATE email_codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at IS NULL', [t, email, purpose]);

    const real = purpose === 'signup' ? !user : !!user;                  // 진짜 번호를 보낼 경우인가
    const code = newCode();
    const hash = real ? hmacHex(secret, `${email}|${purpose}|${code}`) : hmacHex(secret, `decoy|${newToken()}`);   // 가짜 기록은 아무 번호로도 맞출 수 없다
    const ins = await db.run('INSERT INTO email_codes (email, purpose, nickname, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [email, purpose, nickname, hash, t, t + num('CODE_TTL_S') * 1000]);
    try {
      if (real) await mailer.send({ to: email, ...codeMail(code, purpose, Math.round(num('CODE_TTL_S') / 60)) });
      else if (purpose === 'signup') await mailer.send({ to: email, ...existsMail() });
    } catch (e) {
      await db.run('UPDATE email_codes SET used_at = ? WHERE id = ?', [t, ins.insertId]);
      console.error('[메일 발송 실패]', e && e.message);
      throw new HttpError(502, 'mail_failed', '인증 메일을 보내지 못했어요. 이메일 주소를 확인하고 잠시 뒤에 다시 시도해 주세요');
    }
    return { ok: true, expiresIn: num('CODE_TTL_S'), resendIn: num('RESEND_COOLDOWN_S'), ...(showDevCode && real ? { devCode: code } : {}) };   // 개발용 번호 노출은 메일을 안 보내는 서버에서만
  }

  /* ---------- 인증번호 확인 ---------- */
  async function verifyCode(req) {
    const b = await readJson(req);
    const email = normEmail(b.email), purpose = b.purpose === 'reset' ? 'reset' : 'signup', code = String(b.code ?? '').trim();
    if (!validEmail(email)) throw new HttpError(400, 'bad_email', '이메일 형식이 맞지 않아요');
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'bad_code', '인증번호는 숫자 6자리예요');
    const t = now();
    const row = await db.get('SELECT id, nickname, code_hash, attempts, expires_at FROM email_codes WHERE email = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', [email, purpose]);
    if (!row) throw new HttpError(400, 'no_code', '인증번호를 먼저 받아 주세요');
    if (Number(row.expires_at) <= t) { await db.run('UPDATE email_codes SET used_at = ? WHERE id = ?', [t, row.id]); throw new HttpError(400, 'expired', '입력 시간이 지났어요. 인증번호를 다시 받아 주세요'); }
    /* 먼저 시도 횟수를 올리고(동시에 여러 번 찍어 봐도 5번을 넘기지 못한다) 그다음 비교 */
    const inc = await db.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND used_at IS NULL', [row.id, num('MAX_ATTEMPTS')]);
    if (inc.changes !== 1) { await db.run('UPDATE email_codes SET used_at = ? WHERE id = ?', [t, row.id]); throw new HttpError(429, 'too_many', '시도 횟수를 넘었어요. 인증번호를 다시 받아 주세요'); }
    if (!safeEqual(hmacHex(secret, `${email}|${purpose}|${code}`), row.code_hash)) {
      const left = Math.max(num('MAX_ATTEMPTS') - (Number(row.attempts) + 1), 0);
      throw new HttpError(400, 'wrong_code', left ? `인증번호가 맞지 않아요. ${left}번 더 시도할 수 있어요` : '인증번호가 맞지 않아요. 인증번호를 다시 받아 주세요', { attemptsLeft: left });
    }
    const used = await db.run('UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [t, row.id]);
    if (used.changes !== 1) throw new HttpError(400, 'no_code', '인증번호를 먼저 받아 주세요');
    return { ok: true, verifyToken: sign(secret, { p: purpose, e: email, n: row.nickname, exp: t + num('VERIFY_TOKEN_TTL_S') * 1000 }) };
  }

  /* ---------- 가입 완료 (이메일 인증 + 비밀번호) ---------- */
  async function signup(req) {
    const b = await readJson(req);
    const p = unsign(secret, b.verifyToken, now());
    if (!p || p.p !== 'signup' || !validEmail(String(p.e)) || !NICK_RE.test(String(p.n))) throw new HttpError(400, 'bad_token', '인증이 만료됐어요. 인증번호를 다시 받아 주세요');
    const bad = passwordProblem(b.password, { email: p.e, nickname: p.n });
    if (bad) throw new HttpError(400, 'weak_password', bad);
    const t = now(), hash = await hashPassword(b.password);
    let id, pub;
    for (let i = 0; ; i++) {
      pub = newPublicId('u_');
      try {
        id = (await db.run('INSERT INTO users (public_id, email, nickname, nickname_key, password_hash, created_at, last_login_at, pw_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [pub, p.e, p.n, p.n.toLowerCase(), hash, t, t, t])).insertId;
        break;
      } catch (e) {
        if (!isDuplicate(e)) throw e;
        if (await db.get('SELECT id FROM users WHERE email = ?', [p.e])) throw new HttpError(409, 'email_taken', '이미 가입된 이메일이에요. 로그인해 주세요');
        if (await db.get('SELECT id FROM users WHERE nickname_key = ?', [p.n.toLowerCase()])) throw new HttpError(409, 'nickname_taken', '그 사이 다른 사람이 같은 닉네임을 썼어요. 닉네임을 바꿔서 다시 시도해 주세요');
        if (i >= 4) throw e;                                        // 공개 id 가 우연히 겹친 경우: 다시 뽑는다
      }
    }
    const s = await createSession(id);
    return { ok: true, token: s.token, expiresAt: s.expiresAt, user: { uid: pub, nickname: p.n, email: p.e } };
  }

  /* ---------- 로그인 (이메일 + 비밀번호) ----------
     틀린 이유(없는 이메일 / 비밀번호 틀림 / 비밀번호 미설정)를 구분해서 알려 주지 않는다. 걸리는 시간도 비슷하게 맞춘다. */
  async function login(req) {
    const b = await readJson(req);
    const email = normEmail(b.email), pw = String(b.password ?? '');
    const generic = () => new HttpError(401, 'bad_credentials', '이메일 또는 비밀번호가 맞지 않아요. 비밀번호를 정한 적이 없다면 "비밀번호 찾기"로 정할 수 있어요');
    if (!validEmail(email) || !pw || pw.length > 200) throw generic();
    if (!loginIp(clientIp(req)) || !loginEmail(sha256(email))) throw new HttpError(429, 'rate_login', '로그인 시도가 너무 많아요. 15분쯤 뒤에 다시 시도해 주세요');
    const u = await db.get('SELECT id, public_id, email, nickname, password_hash FROM users WHERE email = ?', [email]);
    const ok = u && u.password_hash ? await verifyPassword(pw, u.password_hash) : await dummyVerify(pw);
    if (!ok) throw generic();
    const s = await createSession(u.id);
    return { ok: true, token: s.token, expiresAt: s.expiresAt, user: publicUser(u) };
  }

  /* ---------- 비밀번호 재설정 (이메일 인증 후) ---------- */
  async function resetPassword(req) {
    const b = await readJson(req);
    const p = unsign(secret, b.verifyToken, now());
    if (!p || p.p !== 'reset' || !validEmail(String(p.e))) throw new HttpError(400, 'bad_token', '인증이 만료됐어요. 인증번호를 다시 받아 주세요');
    const u = await db.get('SELECT id, public_id, email, nickname FROM users WHERE email = ?', [p.e]);
    if (!u) throw new HttpError(400, 'bad_token', '인증이 만료됐어요. 인증번호를 다시 받아 주세요');
    const bad = passwordProblem(b.password, { email: u.email, nickname: u.nickname });
    if (bad) throw new HttpError(400, 'weak_password', bad);
    const t = now();
    await db.run('UPDATE users SET password_hash = ?, pw_changed_at = ? WHERE id = ?', [await hashPassword(b.password), t, u.id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);                 // 다른 기기의 로그인은 모두 풀린다
    const s = await createSession(u.id);
    return { ok: true, token: s.token, expiresAt: s.expiresAt, user: publicUser(u) };
  }

  /* ---------- 내 데이터 : 제보 · 최근 검색 (이 계정 것만 읽고 쓴다) ---------- */
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  function reportInput(b) {
    const road = clean(b.roadName, 40), addr = clean(b.address, 100), lv = Number(b.riskLevel);
    const cntRaw = b.accidentCount;
    if (road.length < 2) throw new HttpError(400, 'bad_report', '도로명을 2자 이상 입력해 주세요');
    if (addr.length < 4) throw new HttpError(400, 'bad_report', '주소를 4자 이상 입력해 주세요');
    if (![1, 2, 3, 4].includes(lv)) throw new HttpError(400, 'bad_report', '위험등급은 1~4 중 하나예요');
    let cnt = null;
    if (cntRaw !== null && cntRaw !== undefined && cntRaw !== '') { cnt = Number(cntRaw); if (!Number.isInteger(cnt) || cnt < 0 || cnt > 999) throw new HttpError(400, 'bad_report', '사고 건수는 0~999 사이 숫자예요'); }
    return { road, addr, lv, cnt };
  }
  const reportOut = r => ({ segmentId: r.public_id, roadName: r.road_name, address: r.address, riskLevel: Number(r.risk_level), accidentCount: r.accident_count === null ? null : Number(r.accident_count), createdAt: Number(r.created_at), updatedAt: r.updated_at === null ? null : Number(r.updated_at) });
  const recentOut = r => ({ id: r.public_id, kind: r.kind, ...(r.kind === 'route' ? { origin: r.origin, destination: r.destination } : { q: r.q }), at: Number(r.searched_at) });
  const REPORT_COLS = 'public_id, road_name, address, risk_level, accident_count, created_at, updated_at';

  async function insertReport(uid, v, t) {
    for (let i = 0; ; i++) {
      const pid = newPublicId('user-');
      try { await db.run('INSERT INTO reports (public_id, user_id, road_name, address, risk_level, accident_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [pid, uid, v.road, v.addr, v.lv, v.cnt, t]); return pid; }
      catch (e) { if (!isDuplicate(e) || i >= 4) throw e; }
    }
  }
  async function reportCount(uid) { return Number((await db.get('SELECT COUNT(*) AS n FROM reports WHERE user_id = ?', [uid])).n); }

  async function addRecent(uid, b, t) {
    const kind = b.kind === 'route' ? 'route' : 'keyword';
    const q = kind === 'keyword' ? clean(b.q, 60) : null, o = kind === 'route' ? clean(b.origin, 60) : null, d = kind === 'route' ? clean(b.destination, 60) : null;
    if (kind === 'keyword' ? !q : !o || !d) throw new HttpError(400, 'bad_recent', '검색어가 비어 있어요');
    /* 같은 검색은 맨 위로 올리려고 지우고 다시 넣는다. 사람마다 최근 10건만 남긴다 */
    if (kind === 'keyword') await db.run("DELETE FROM recent_searches WHERE user_id = ? AND kind = 'keyword' AND q = ?", [uid, q]);
    else await db.run("DELETE FROM recent_searches WHERE user_id = ? AND kind = 'route' AND origin = ? AND destination = ?", [uid, o, d]);
    let pid;
    for (let i = 0; ; i++) {
      pid = newPublicId('rc_');
      try { await db.run('INSERT INTO recent_searches (public_id, user_id, kind, q, origin, destination, searched_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [pid, uid, kind, q, o, d, t]); break; }
      catch (e) { if (!isDuplicate(e) || i >= 4) throw e; }
    }
    const old = await db.all('SELECT id FROM recent_searches WHERE user_id = ? ORDER BY searched_at DESC, id DESC', [uid]);
    for (const r of old.slice(num('RECENT_MAX'))) await db.run('DELETE FROM recent_searches WHERE id = ?', [r.id]);
    return pid;
  }

  const myData = async a => ({
    ok: true,
    reports: (await db.all(`SELECT ${REPORT_COLS} FROM reports WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [a.id])).map(reportOut),
    recents: (await db.all('SELECT public_id, kind, q, origin, destination, searched_at FROM recent_searches WHERE user_id = ? ORDER BY searched_at DESC, id DESC', [a.id])).map(recentOut)
  });

  const routes = {
    'GET /api/health': async () => ({ ok: true, service: 'safe-drive', version: '0.6', db: db.kind, mail: mailer.kind }),
    'POST /api/auth/request-code': requestCode,
    'POST /api/auth/verify-code': verifyCode,
    'POST /api/auth/signup': signup,
    'POST /api/auth/login': login,
    'POST /api/auth/reset-password': resetPassword,
    'GET /api/me': async req => ({ ok: true, user: publicUser(await authed(req)) }),
    'POST /api/auth/logout': async req => { const a = await authed(req); await db.run('DELETE FROM sessions WHERE token_hash = ?', [a.tokenHash]); return { ok: true }; },
    /* 탈퇴: 비밀번호를 한 번 더 확인한다 (비밀번호가 아직 없는 옛 계정은 로그인 상태면 허용) */
    'DELETE /api/me': async req => {
      const a = await authed(req), b = await readJson(req);
      const u = await db.get('SELECT password_hash FROM users WHERE id = ?', [a.id]);
      if (u.password_hash && !(await verifyPassword(String(b.password ?? ''), u.password_hash))) throw new HttpError(403, 'bad_password', '비밀번호가 맞지 않아요');
      await db.transaction(async tx => {
        for (const sql of ['DELETE FROM reports WHERE user_id = ?', 'DELETE FROM recent_searches WHERE user_id = ?', 'DELETE FROM sessions WHERE user_id = ?']) await tx.run(sql, [a.id]);
        await tx.run('DELETE FROM email_codes WHERE email = ?', [a.email]);
        await tx.run('DELETE FROM users WHERE id = ?', [a.id]);
      });
      return { ok: true };
    },
    'GET /api/me/data': async req => myData(await authed(req)),
    'DELETE /api/me/data': async req => { const a = await authed(req); await db.run('DELETE FROM reports WHERE user_id = ?', [a.id]); await db.run('DELETE FROM recent_searches WHERE user_id = ?', [a.id]); return { ok: true }; },
    'POST /api/reports': async req => {
      const a = await authed(req), v = reportInput(await readJson(req));
      if (await reportCount(a.id) >= num('REPORT_MAX')) throw new HttpError(429, 'quota', `제보는 ${num('REPORT_MAX')}건까지 저장할 수 있어요`);
      const t = now(), pid = await insertReport(a.id, v, t);
      return { ok: true, report: reportOut(await db.get(`SELECT ${REPORT_COLS} FROM reports WHERE public_id = ?`, [pid])) };
    },
    'PUT /api/reports/:id': async (req, id) => {
      const a = await authed(req), v = reportInput(await readJson(req)), t = now();
      const r = await db.run('UPDATE reports SET road_name = ?, address = ?, risk_level = ?, accident_count = ?, updated_at = ? WHERE public_id = ? AND user_id = ?', [v.road, v.addr, v.lv, v.cnt, t, id, a.id]);
      if (r.changes !== 1) throw new HttpError(404, 'not_found', '제보를 찾을 수 없어요');       // 남의 제보도 똑같이 '없음'으로 답한다
      return { ok: true, report: reportOut(await db.get(`SELECT ${REPORT_COLS} FROM reports WHERE public_id = ?`, [id])) };
    },
    'DELETE /api/reports/:id': async (req, id) => {
      const a = await authed(req);
      const r = await db.run('DELETE FROM reports WHERE public_id = ? AND user_id = ?', [id, a.id]);
      if (r.changes !== 1) throw new HttpError(404, 'not_found', '제보를 찾을 수 없어요');
      return { ok: true };
    },
    'POST /api/recents': async req => { const a = await authed(req); const id = await addRecent(a.id, await readJson(req), now()); return { ok: true, id }; },
    'DELETE /api/recents/:id': async (req, id) => { const a = await authed(req); await db.run('DELETE FROM recent_searches WHERE public_id = ? AND user_id = ?', [id, a.id]); return { ok: true }; },
    'DELETE /api/recents': async req => { const a = await authed(req); await db.run('DELETE FROM recent_searches WHERE user_id = ?', [a.id]); return { ok: true }; },
    /* 이 기기에 있던 제보·최근 검색을 계정으로 올린다 (v0.5 까지는 기기에만 저장했다). 올린 개수를 돌려준다 */
    'POST /api/me/import': async req => {
      const a = await authed(req), b = await readJson(req, 300_000), t = now();
      let reports = 0, recents = 0, skipped = 0;
      const rs = Array.isArray(b.reports) ? b.reports.slice(0, num('REPORT_MAX')) : [];
      let have = await reportCount(a.id);
      for (const x of rs) {
        let v; try { v = reportInput(x || {}); } catch { skipped++; continue; }
        if (have >= num('REPORT_MAX')) { skipped++; continue; }
        await insertReport(a.id, v, t - reports); reports++; have++;
      }
      for (const x of (Array.isArray(b.recents) ? b.recents : []).slice(0, num('RECENT_MAX')).reverse()) {
        try { await addRecent(a.id, x || {}, t + recents); recents++; } catch { skipped++; }
      }
      return { ok: true, reports, recents, skipped };
    }
  };
  /* '/api/reports/:id' 같은 주소를 찾는다. id 는 무작위 문자열 모양만 받는다 */
  function findRoute(method, pathname) {
    const exact = routes[`${method} ${pathname}`];
    if (exact) return [exact, undefined];
    const m = /^(\/api\/(?:reports|recents))\/([a-z0-9_-]{6,40})$/.exec(pathname);
    const fn = m && routes[`${method} ${m[1]}/:id`];
    return fn ? [fn, m[2]] : [null];
  }

  function cors(req, res) {
    const o = req.headers.origin;
    if (o && origins.has(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

  async function api(req, res, url) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const [fn, param] = findRoute(req.method, url.pathname);
    try {
      if (!fn) throw new HttpError(404, 'not_found', '없는 주소예요');
      return send(res, 200, await fn(req, param));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.code, message: e.message, ...e.extra });
      console.error('[서버 오류]', e);
      return send(res, 500, { ok: false, error: 'server', message: '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요' });
    }
  }

  async function serveStatic(req, res, url) {
    const root = path.resolve(C.STATIC_DIR);
    let rel; try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const parts = rel.split('/').filter(Boolean);
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep) || parts.some(x => x.startsWith('.')) || NO_STATIC.has(parts[0])) { res.writeHead(404); return res.end('not found'); }
    try {
      const st = await fs.stat(file); if (!st.isFile()) throw 0;
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') return res.end();
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); }
  }

  async function handle(req, res) {
    const t0 = Date.now();
    res.on('finish', () => { if (!C.QUIET) console.log(`${req.method} ${String(req.url).split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`); });
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    if (C.STATIC_DIR && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res, url);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found');
  }

  return { handle };
}
