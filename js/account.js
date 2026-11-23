/* account.js — 회원 서버(server/)와 대화하는 쪽
   서버가 없으면(GitHub Pages 처럼 화면만 올린 경우) probe() 가 null 을 돌려주고, 가입 화면은 '실습 모드'(이 기기에만 저장)로 동작한다.
   로그인 정보: sd_token(서버가 준 로그인 유지 토큰) + sd_user(닉네임·이메일·공개 id, 화면 표시용). 둘 다 이 기기 localStorage 에만 둔다. */
/* apiBase · getToken · TOKEN_KEY 는 common.js 에 있다 (헤더의 로그아웃도 같은 걸 쓰므로) */
const Account = (() => {
  const call = (m, p, b, a) => apiCall(m, p, b, a);
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
    signup: (verifyToken, password) => call('POST', '/api/auth/signup', { verifyToken, password }),
    login: (email, password) => call('POST', '/api/auth/login', { email, password }),
    resetPassword: (verifyToken, password) => call('POST', '/api/auth/reset-password', { verifyToken, password }),
    me: () => call('GET', '/api/me', undefined, true),
    withdraw: password => call('DELETE', '/api/me', { password }, true),
    /* 가입·로그인에 성공했을 때: 토큰과 표시용 정보를 이 기기에 두고, 로그인 전에 이 기기에 쌓인 제보·최근 검색을 계정으로 올린 뒤 서버 것을 받아 온다 */
    async saveSession(r) {
      try { localStorage.setItem(TOKEN_KEY, r.token); } catch {}
      store.set(KEY.user, { nickname: r.user.nickname, email: r.user.email, uid: r.user.uid, server: true });
      try { await syncUp(); await syncDown(true); } catch {}
    },
    clearSession() { try { localStorage.removeItem(TOKEN_KEY); } catch {} store.remove(KEY.user); store.remove(KEY.report); store.remove(KEY.recent); }
  };
})();
