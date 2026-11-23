/* auth.js — 암호 관련 작은 도구들 (Node 내장 crypto 만 사용) */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');

/* 길이가 달라도 안전하게(타이밍 공격 방지) 같은지 비교 */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* 인증번호 6자리 : Math.random 이 아니라 암호학적 난수 */
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/* 로그인 유지용 토큰 : 서버에는 해시만 저장하므로 DB 가 새도 그대로는 쓸 수 없다 */
export const newToken = () => crypto.randomBytes(32).toString('base64url');

/* 서명된 짧은 토큰 (인증번호 확인 → 가입 완료 사이를 잇는다). 값은 읽을 수 있지만 위조는 못 한다 */
export function sign(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
export function unsign(secret, token, nowMs) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(mac, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && typeof p.exp === 'number' && p.exp > nowMs ? p : null;
  } catch { return null; }
}

/* ---------- 비밀번호 ----------
   scrypt(메모리를 많이 쓰는 느린 해시) + 사람마다 다른 무작위 salt. 저장 모양: scrypt$N$r$p$salt$hash (base64url)
   같은 비밀번호라도 사람마다 해시가 달라서, DB 가 새도 "같은 비밀번호를 쓰는 사람"을 알아낼 수 없다. */
const SCRYPT = { N: 16384, r: 8, p: 1 };
const scryptKey = (pw, salt, o) => scrypt(String(pw).normalize('NFKC'), salt, 64, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 });
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16), key = await scryptKey(pw, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}
export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  try {
    const key = await scryptKey(pw, Buffer.from(salt, 'base64url'), { N: +N, r: +r, p: +p });
    return safeEqual(key.toString('base64url'), hash);
  } catch { return false; }
}
/* 없는 계정으로 로그인해 봐도 걸리는 시간이 같도록, 가짜 해시를 한 번 만들어 두고 비교만 해 본다 */
let dummy; export const dummyVerify = async pw => { dummy ||= await hashPassword('dummy-' + crypto.randomBytes(8).toString('hex')); await verifyPassword(pw, dummy); return false; };

const COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'password123', 'qwerty123', 'qwertyuiop', 'abcd1234', 'abc12345', 'a1234567', 'iloveyou1', '11111111', 'asdf1234', 'q1w2e3r4', '1q2w3e4r']);
/* 비밀번호 규칙: 8~64자 · 영문과 숫자를 모두 포함 · 흔한 비밀번호·이메일 앞부분·닉네임이 들어가면 안 된다. 틀린 점을 문장으로 돌려준다(통과하면 null) */
export function passwordProblem(pw, { email = '', nickname = '' } = {}) {
  const s = String(pw ?? '');
  if (s.length < 8 || s.length > 64) return '비밀번호는 8~64자로 정해 주세요';
  if (/[\u0000-\u001f]/.test(s)) return '비밀번호에 쓸 수 없는 문자가 있어요';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return '비밀번호에는 영문과 숫자를 모두 넣어 주세요';
  const low = s.toLowerCase(), local = String(email).split('@')[0].toLowerCase();
  if (COMMON.has(low)) return '너무 흔한 비밀번호예요. 다른 비밀번호를 정해 주세요';
  if (local.length >= 4 && low.includes(local)) return '이메일 앞부분이 들어간 비밀번호는 쓸 수 없어요';
  if (String(nickname).length >= 2 && low.includes(String(nickname).toLowerCase())) return '닉네임이 들어간 비밀번호는 쓸 수 없어요';
  return null;
}

/* ---------- 공개용 id ----------
   DB 안의 순번(1, 2, 3…)은 밖으로 내보내지 않는다. 순번을 알면 "몇 번째 가입자"를 짐작하거나 다음 번호를 찍어 볼 수 있어서,
   밖에는 무작위 문자열 id 만 쓴다 (예: u_k3x9m2q8w4tz, user-7hq2m9x4k8ab). 헷갈리는 글자(0 o 1 l i)는 뺀다. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newPublicId = (prefix, n = 12) => prefix + Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
