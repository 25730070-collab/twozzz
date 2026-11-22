/* auth.js — 암호 관련 작은 도구들 (Node 내장 crypto 만 사용) */
import crypto from 'node:crypto';

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
