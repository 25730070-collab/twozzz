/* account.js — 회원 서버(server/)와 대화하는 쪽
   서버가 없으면(GitHub Pages 처럼 화면만 올린 경우) probe() 가 null 을 돌려주고, 가입 화면은 '실습 모드'(이 기기에만 저장)로 동작한다.
   로그인 정보: sd_token(서버가 준 로그인 유지 토큰) + sd_user(닉네임·이메일, 화면 표시용). 둘 다 이 기기 localStorage 에만 둔다. */
/* apiBase · getToken · TOKEN_KEY 는 common.js 에 있다 (헤더의 로그아웃도 같은 걸 쓰므로) */
const Account = (() => {
  async function call(method, path, body, authed) {
    const headers = { 'Content-Type': 'application/json' };
    if (authed) { const t = getToken(); if (t) headers.Authorization = 'Bearer ' + t; }
    let res;
    try { res = await fetch(apiBase() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) }); }
    catch { throw Object.assign(new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요'), { code: 'network' }); }
    let j = null; try { j = await res.json(); } catch {}
    if (!res.ok || !j || j.ok === false) throw Object.assign(new Error((j && j.message) || '요청을 처리하지 못했어요'), { code: (j && j.error) || 'http_' + res.status, status: res.status, data: j || {} });
    return j;
  }
  return {
    /* 서버가 있는지 확인 → {mail, db} 또는 null. 이 사이트와 같은 주소에 /api/health 가 없으면(404 등) null */
    async probe() {
      try {
        const r = await fetch(apiBase() + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        return j && j.service === 'safe-drive' ? { mail: j.mail, db: j.db } : null;
      } catch { return null; }
    },
    requestCode: b => call('POST', '/api/auth/request-code', b),
    verifyCode: b => call('POST', '/api/auth/verify-code', b),
    signup: verifyToken => call('POST', '/api/auth/signup', { verifyToken }),
    me: () => call('GET', '/api/me', undefined, true),
    withdraw: () => call('DELETE', '/api/me', undefined, true),
    /* 가입·로그인에 성공했을 때: 토큰과 표시용 정보를 이 기기에 둔다 */
    saveSession(r) {
      try { localStorage.setItem(TOKEN_KEY, r.token); } catch {}
      store.set(KEY.user, { nickname: r.user.nickname, email: r.user.email, server: true });
    },
    clearSession() { try { localStorage.removeItem(TOKEN_KEY); } catch {} store.remove(KEY.user); }
  };
})();
