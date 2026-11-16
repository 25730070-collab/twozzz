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
  const list = getRecent().filter(r => !(r.kind !== 'route' && r.q === q));
  list.unshift({ id: 'rc' + Date.now(), kind: 'keyword', q, at: nowText() });
  store.set(KEY.recent, list.slice(0, 10));
}
/* 최근 검색 : 경로 (출발 → 도착) */
function addRecentRoute(o, d) {
  const list = getRecent().filter(r => !(r.kind === 'route' && r.origin === o && r.destination === d));
  list.unshift({ id: 'rc' + Date.now(), kind: 'route', origin: o, destination: d, at: nowText() });
  store.set(KEY.recent, list.slice(0, 10));
}

/* 경로 즐겨찾기 */
const routeFavMatch = (f, o, d) => f.kind === 'route' && f.origin === o && f.destination === d;
const isRouteFav = (o, d) => getFavs().some(f => routeFavMatch(f, o, d));
function toggleRouteFav(o, d) {
  let favs = getFavs();
  const on = favs.some(f => routeFavMatch(f, o, d));
  if (on) favs = favs.filter(f => !routeFavMatch(f, o, d));
  else favs.unshift({ id: 'fv' + Date.now(), kind: 'route', origin: o, destination: d, savedAt: nowText().slice(0, 5) });
  store.set(KEY.fav, favs); return !on;
}

/* 제보 수정 */
function updateReport(id, patch) {
  const list = getReports().map(r => {
    if (r.segmentId !== id) return r;
    const n = { ...r, ...patch, updatedAt: nowText() };
    n.meta = { ...r.meta, user: ['roadName', 'riskLevel', 'address', ...(n.accidentCount == null ? [] : ['accidentCount'])] };
    return n;
  });
  store.set(KEY.report, list);
}

/* ---------- 내 데이터(U) JSON : 내려받기 · 가져오기 · 초기화 ---------- */
const USER_DATASETS = {
  favorites_user: { key: KEY.fav, label: '즐겨찾기' },
  recent_searches_user: { key: KEY.recent, label: '최근 검색' },
  reports_user: { key: KEY.report, label: '내 제보' }
};
const exportUser = () => Object.fromEntries(Object.entries(USER_DATASETS).map(([n, d]) => [n, store.get(d.key, [])]));
const isStr = v => typeof v === 'string' && v.trim() !== '';
const VALID = {
  favorites_user: f => f && ((f.kind === 'segment' && isStr(f.segmentId)) || (f.kind === 'route' && isStr(f.origin) && isStr(f.destination))),
  recent_searches_user: r => r && ((r.kind === 'route' && isStr(r.origin) && isStr(r.destination)) || ((r.kind === 'keyword' || !r.kind) && isStr(r.q))),
  reports_user: r => r && isStr(r.roadName) && isStr(r.address) && [1, 2, 3, 4].includes(r.riskLevel) && r.source === 'user' && isStr(r.segmentId)
};
/* 가져오기 : 형식이 맞는 항목만 합친다 (같은 id는 건너뜀). 결과 {added, skipped, unknown} */
function importUser(obj) {
  const res = { added: {}, skipped: 0, unknown: [] };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('내 데이터 JSON 형식이 아니에요');
  Object.keys(obj).forEach(name => {
    const d = USER_DATASETS[name];
    if (!d) { res.unknown.push(name); return; }
    if (!Array.isArray(obj[name])) { res.skipped += 1; return; }
    const cur = store.get(d.key, []), idOf = x => x.id || x.segmentId, have = new Set(cur.map(idOf));
    let n = 0;
    obj[name].forEach(x => {
      if (!VALID[name](x)) { res.skipped++; return; }
      if (!idOf(x)) x = { ...x, id: 'im' + Date.now() + n };
      if (have.has(idOf(x))) { res.skipped++; return; }
      cur.push(x); have.add(idOf(x)); n++;
    });
    store.set(d.key, cur); res.added[name] = n;
  });
  return res;
}
const clearUserData = () => Object.values(USER_DATASETS).forEach(d => store.set(d.key, []));

/* 사용자 제보 저장 — 정적 웹/앱에서는 JSON 파일에 쓸 수 없어 LocalStorage에 저장한다 (서버가 생기면 POST로 교체) */
function addReport(r) {
  const list = getReports();
  const row = { segmentId: 'user-' + Date.now(), ...r, source: 'user', createdAt: nowText(),
    meta: { source: 'user', real: [], dummy: [], api: [], user: ['roadName', 'riskLevel', 'address', ...(r.accidentCount == null ? [] : ['accidentCount'])], note: '사용자가 직접 입력한 제보 — 검증 전' } };
  list.unshift(row); store.set(KEY.report, list); return row;
}
