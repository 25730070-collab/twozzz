/* app.js — Safe Drive 회원 서버 (Node 내장 http 만 사용, 프레임워크 없음)
   회원가입 · 로그인 모두 '이메일 인증번호'로 하는 비밀번호 없는 방식이다.

   POST   /api/auth/request-code  {email, purpose:'signup'|'login', nickname?}  → 인증번호 메일 발송
   POST   /api/auth/verify-code   {email, purpose, code}                        → signup: {verifyToken} / login: {token,user}
   POST   /api/auth/signup        {verifyToken}                                 → {token,user}   (닉네임은 인증 때 서버가 정한 값)
   GET    /api/me                 Authorization: Bearer <token>                 → {user}
   POST   /api/auth/logout        Authorization                                 → {ok}
   DELETE /api/me                 Authorization                                 → 회원 탈퇴(계정·세션·인증 기록 삭제)
   GET    /api/health                                                           → 연결 확인 (프런트가 서버 유무를 알아본다)

   지키는 것: 인증번호는 평문으로 저장하지 않고(HMAC) · 3분 · 5번까지 · 재전송 60초 간격 · 이메일당 시간당 5번 · IP당 시간당 20번 ·
              세션 토큰도 해시로만 저장 · 응답에 인증번호를 싣지 않음(개발용 DEV_SHOW_CODE 는 메일 미설정일 때만) */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256, hmacHex, safeEqual, newCode, newToken, sign, unsign } from './auth.js';
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
  const what = purpose === 'login' ? '로그인' : '회원가입';
  return {
    subject: `[Safe Drive] ${what} 인증번호 ${code}`,
    text: `Safe Drive ${what} 인증번호: ${code}\n\n${ttlMin}분 안에 입력해 주세요.\n본인이 요청하지 않았다면 이 메일을 무시하셔도 돼요. 이 번호는 다른 사람에게 알려 주지 마세요.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Safe Drive ${what} 인증번호</p>`
      + `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>`
      + `<p style="color:#5b6560;font-size:13px">${ttlMin}분 안에 입력해 주세요. 본인이 요청하지 않았다면 이 메일을 무시하셔도 돼요.</p></div>`
  };
}

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
    SESSION_DAYS: 30, VERIFY_TOKEN_TTL_S: 600, BODY_LIMIT: 10_000,
    ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined && v !== ''))
  };
  const num = k => Number(C[k]);
  const now = () => (typeof C.now === 'function' ? C.now() : Date.now());
  const secret = C.APP_SECRET;
  if (!secret || String(secret).length < 16) throw new Error('APP_SECRET 이 없거나 너무 짧아요(16자 이상)');
  const origins = new Set(String(C.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
  const ipLimit = makeLimiter(num('REQS_PER_IP_HOUR'), 3600_000, now);
  const showDevCode = String(C.DEV_SHOW_CODE) === '1' && mailer.kind === 'console';     // 진짜 메일을 보내는 서버에서는 절대 번호를 응답에 싣지 않는다

  const clientIp = req => {
    if (String(C.TRUST_PROXY) === '1') { const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (xf.length) return xf[xf.length - 1]; }
    return req.socket.remoteAddress || 'unknown';
  };
  const publicUser = u => ({ nickname: u.nickname, email: u.email });

  async function readJson(req) {
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > num('BODY_LIMIT')) throw new HttpError(413, 'too_large', '요청이 너무 커요');
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
    const row = await db.get('SELECT u.id AS id, u.email AS email, u.nickname AS nickname, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha256(m[1])]);
    if (!row || Number(row.expires_at) <= now()) throw new HttpError(401, 'unauthorized', '로그인이 만료됐어요. 다시 로그인해 주세요');
    return { ...row, tokenHash: sha256(m[1]) };
  }

  /* ---------- 인증번호 보내기 ---------- */
  async function requestCode(req) {
    const b = await readJson(req);
    const email = normEmail(b.email), purpose = b.purpose === 'login' ? 'login' : 'signup';
    if (!validEmail(email)) throw new HttpError(400, 'bad_email', '이메일 형식이 맞지 않아요');
    let nickname = null;
    if (purpose === 'signup') {
      nickname = String(b.nickname ?? '').trim();
      if (!NICK_RE.test(nickname)) throw new HttpError(400, 'bad_nickname', '닉네임은 한글·영문·숫자 2~10자예요');
    }
    if (!ipLimit(clientIp(req))) throw new HttpError(429, 'rate_ip', '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요');

    const t = now();
    const user = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (purpose === 'signup') {
      if (user) throw new HttpError(409, 'email_taken', '이미 가입된 이메일이에요. 로그인해 주세요');
      if (await db.get('SELECT id FROM users WHERE nickname_key = ?', [nickname.toLowerCase()])) throw new HttpError(409, 'nickname_taken', '이미 쓰고 있는 닉네임이에요');
    } else if (!user) throw new HttpError(404, 'no_account', '가입된 이메일이 아니에요. 먼저 가입해 주세요');

    const last = await db.get('SELECT created_at FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1', [email]);
    if (last) {
      const wait = Math.ceil((Number(last.created_at) + num('RESEND_COOLDOWN_S') * 1000 - t) / 1000);
      if (wait > 0) throw new HttpError(429, 'cooldown', `${wait}초 뒤에 다시 받을 수 있어요`, { retryAfter: wait });
    }
    const cnt = await db.get('SELECT COUNT(*) AS n FROM email_codes WHERE email = ? AND created_at > ?', [email, t - 3600_000]);
    if (Number(cnt.n) >= num('CODES_PER_EMAIL_HOUR')) throw new HttpError(429, 'rate_email', '이 이메일로는 1시간에 인증번호를 5번까지 받을 수 있어요. 나중에 다시 시도해 주세요');

    /* 오래된 기록 정리 + 이전 번호 무효화 */
    await db.run('DELETE FROM email_codes WHERE expires_at < ?', [t - 86400_000]);
    await db.run('DELETE FROM sessions WHERE expires_at < ?', [t]);
    await db.run('UPDATE email_codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at IS NULL', [t, email, purpose]);

    const code = newCode();
    const ins = await db.run('INSERT INTO email_codes (email, purpose, nickname, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [email, purpose, nickname, hmacHex(secret, `${email}|${purpose}|${code}`), t, t + num('CODE_TTL_S') * 1000]);
    try {
      await mailer.send({ to: email, ...codeMail(code, purpose, Math.round(num('CODE_TTL_S') / 60)) });
    } catch (e) {
      await db.run('UPDATE email_codes SET used_at = ? WHERE id = ?', [t, ins.insertId]);
      console.error('[메일 발송 실패]', e && e.message);
      throw new HttpError(502, 'mail_failed', '인증 메일을 보내지 못했어요. 이메일 주소를 확인하고 잠시 뒤에 다시 시도해 주세요');
    }
    return { ok: true, expiresIn: num('CODE_TTL_S'), resendIn: num('RESEND_COOLDOWN_S'), ...(showDevCode ? { devCode: code } : {}) };
  }

  /* ---------- 인증번호 확인 ---------- */
  async function verifyCode(req) {
    const b = await readJson(req);
    const email = normEmail(b.email), purpose = b.purpose === 'login' ? 'login' : 'signup', code = String(b.code ?? '').trim();
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

    if (purpose === 'login') {
      const u = await db.get('SELECT id, email, nickname FROM users WHERE email = ?', [email]);
      if (!u) throw new HttpError(404, 'no_account', '가입된 이메일이 아니에요. 먼저 가입해 주세요');
      const s = await createSession(u.id);
      return { ok: true, token: s.token, expiresAt: s.expiresAt, user: publicUser(u) };
    }
    return { ok: true, verifyToken: sign(secret, { p: 'signup', e: email, n: row.nickname, exp: t + num('VERIFY_TOKEN_TTL_S') * 1000 }) };
  }

  /* ---------- 가입 완료 ---------- */
  async function signup(req) {
    const b = await readJson(req);
    const p = unsign(secret, b.verifyToken, now());
    if (!p || p.p !== 'signup' || !validEmail(String(p.e)) || !NICK_RE.test(String(p.n))) throw new HttpError(400, 'bad_token', '인증이 만료됐어요. 인증번호를 다시 받아 주세요');
    const t = now();
    let id;
    try {
      id = (await db.run('INSERT INTO users (email, nickname, nickname_key, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)', [p.e, p.n, p.n.toLowerCase(), t, t])).insertId;
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      if (await db.get('SELECT id FROM users WHERE email = ?', [p.e])) throw new HttpError(409, 'email_taken', '이미 가입된 이메일이에요. 로그인해 주세요');
      throw new HttpError(409, 'nickname_taken', '그 사이 다른 사람이 같은 닉네임을 썼어요. 닉네임을 바꿔서 다시 시도해 주세요');
    }
    const s = await createSession(id);
    return { ok: true, token: s.token, expiresAt: s.expiresAt, user: { nickname: p.n, email: p.e } };
  }

  const routes = {
    'GET /api/health': async () => ({ ok: true, service: 'safe-drive', db: db.kind, mail: mailer.kind }),
    'POST /api/auth/request-code': requestCode,
    'POST /api/auth/verify-code': verifyCode,
    'POST /api/auth/signup': signup,
    'GET /api/me': async req => ({ ok: true, user: publicUser(await authed(req)) }),
    'POST /api/auth/logout': async req => { const a = await authed(req); await db.run('DELETE FROM sessions WHERE token_hash = ?', [a.tokenHash]); return { ok: true }; },
    'DELETE /api/me': async req => {
      const a = await authed(req);
      await db.run('DELETE FROM sessions WHERE user_id = ?', [a.id]);
      await db.run('DELETE FROM email_codes WHERE email = ?', [a.email]);
      await db.run('DELETE FROM users WHERE id = ?', [a.id]);
      return { ok: true };
    }
  };

  function cors(req, res) {
    const o = req.headers.origin;
    if (o && origins.has(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    const fn = routes[`${req.method} ${url.pathname}`];
    try {
      if (!fn) throw new HttpError(404, 'not_found', '없는 주소예요');
      return send(res, 200, await fn(req));
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
