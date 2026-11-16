/* storage.js — LocalStorage (사용자 상태 전용: 즐겨찾기 · 최근검색 · 제보 · 가입 정보) */
const KEY = { recent: 'sd_recent', fav: 'sd_favorites', user: 'sd_user', report: 'sd_reports' };

const store = {
  get(key, seed) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) { if (seed !== undefined) this.set(key, seed); return seed === undefined ? null : seed; }
      return JSON.parse(v);
    } catch { return seed === undefined ? null : seed; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} }
};

const getRecent = () => store.get(KEY.recent, []);
const getFavs = () => store.get(KEY.fav, []);
const getReports = () => store.get(KEY.report, []);   // 사용자가 제보한 위험 구간 (source: "user")

const nowText = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 최근 검색 : 위험 구간 검색어 (최대 10건, 최신순) */
function addRecent(q) {
  const list = getRecent().filter(r => r.q !== q);
  list.unshift({ id: 'rc' + Date.now(), q, at: nowText() });
  store.set(KEY.recent, list.slice(0, 10));
}

/* 사용자 제보 저장 — 정적 웹/앱에서는 JSON 파일에 쓸 수 없어 LocalStorage에 저장한다 (서버가 생기면 POST로 교체) */
function addReport(r) {
  const list = getReports();
  const row = { segmentId: 'user-' + Date.now(), ...r, source: 'user', createdAt: nowText(),
    meta: { source: 'user', real: [], dummy: [], api: [], user: ['roadName', 'riskLevel', 'address', ...(r.accidentCount == null ? [] : ['accidentCount'])], note: '사용자가 직접 입력한 제보 — 검증 전' } };
  list.unshift(row); store.set(KEY.report, list); return row;
}
