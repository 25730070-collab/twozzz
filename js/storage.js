/* storage.js — 이 기기(localStorage)에 두는 것과 서버 DB 에 두는 것 (v0.6)

   ── 어디에 저장하나 ───────────────────────────────────────────────
   즐겨찾기  sd_favorites : **이 기기에만** 저장한다 (개인 · 서버로 보내지 않는다). 다른 기기로는 '데이터 관리'의 내보내기·가져오기로 옮긴다.
   최근 검색  sd_recent    : 로그인(회원 서버)했으면 **DB 가 원본**, 이 기기에는 복사본. 로그인 안 했거나 서버가 없으면 이 기기에만.
   내 제보    sd_reports   : 위와 같다.
   로그인 정보 sd_token · sd_user : 이 기기에만 (토큰은 서버가 준 것. sd_user 는 화면 표시용)
   장소 좌표 기억 sd_places : 이 기기의 캐시 (자동완성에서 고른 장소의 좌표)
   임시(탭 닫으면 사라짐) sessionStorage : sd_flash(안내 문구) · sd_rt<번호>|출발|도착(경로 결과 캐시, 번호는 형식 버전)

   ── 저장 키 규칙 ──────────────────────────────────────────────────
   키   : sd_<이름>   소문자·밑줄만, 항상 sd_ 로 시작 (이 사이트 것임을 알 수 있게). 모양이 바뀌면 sd_schema 의 번호를 올리고 옮긴다.
   id   : <접두어>_<시각(36진수)><순번><무작위 3자>   예) fv_mk3x9a0f2z   접두어: fv 즐겨찾기 · rc 최근 검색 · im 가져온 항목
          제보는 segmentId 가 user- 로 시작한다 (예: user-7hq2m9x4k8ab : 서버가 정한 무작위 id / 서버 없이 만든 것은 user-_… )
          서버(DB)의 안쪽 순번 id 는 밖으로 나오지 않고, 밖에는 무작위 public_id 만 쓴다.
   복사본에는 remote:true 가 붙는다 = 서버에 있는 항목. 없으면 아직 서버에 올리지 못한 항목이라 다음 동기화 때 올린다. */
const KEY = { recent: 'sd_recent', fav: 'sd_favorites', user: 'sd_user', report: 'sd_reports', places: 'sd_places', schema: 'sd_schema' };
const SCHEMA = 2;

const store = {
  get(key, seed) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) { if (seed !== undefined) this.set(key, seed); return seed === undefined ? null : seed; }
      const j = JSON.parse(v);
      return Array.isArray(seed) && !Array.isArray(j) ? seed : j;      // 목록인데 다른 모양(손상·직접 수정)이면 빈 목록으로 — 화면이 멈추지 않게
    } catch { return seed === undefined ? null : seed; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} }
};

const getRecent = () => store.get(KEY.recent, []);
const getFavs = () => store.get(KEY.fav, []);
const getReports = () => store.get(KEY.report, []);   // 사용자가 제보한 위험 구간 (source: "user")

/* 항목 id : 같은 밀리초에 여러 개를 저장해도 겹치지 않게 순번과 무작위 값을 붙인다 (겹치면 가져오기에서 같은 항목으로 보고 버린다) */
let uidSeq = 0;
const uid = prefix => `${prefix}${prefix.endsWith('-') ? '' : '_'}${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const fmtAt = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const nowText = () => fmtAt(Date.now());

/* ---------- 서버(DB)와 맞추기 ----------
   로그인(회원 서버) 중이면 제보·최근 검색은 서버 DB 가 원본이다. 화면은 계속 이 기기의 복사본을 바로 읽는다(빠르게 · 오프라인에서도).
   · syncDown : 서버 것을 받아 복사본을 통째로 바꾼다 (페이지마다 한 번)
   · syncUp   : 아직 서버에 없는 항목(remote 표시가 없는 것)을 서버로 올린다 (로그인 직전에 이 기기에 쌓인 것 · 서버가 안 될 때 만든 것 · 가져온 것) */
const remoteOn = () => { const u = store.get(KEY.user); return !!(u && u.server && getToken()); };
const fromServerReport = r => ({
  segmentId: r.segmentId, roadName: r.roadName, address: r.address, accidentCount: r.accidentCount, riskLevel: r.riskLevel, lat: null, lng: null,
  source: 'user', createdAt: fmtAt(r.createdAt), ...(r.updatedAt ? { updatedAt: fmtAt(r.updatedAt) } : {}), meta: userMeta(r.accidentCount), remote: true
});
const fromServerRecent = r => ({ id: r.id, kind: r.kind, ...(r.kind === 'route' ? { origin: r.origin, destination: r.destination } : { q: r.q }), at: fmtAt(r.at), remote: true });
const userMeta = cnt => ({ source: 'user', real: [], dummy: [], api: [], user: ['roadName', 'riskLevel', 'address', ...(cnt == null ? [] : ['accidentCount'])], note: '사용자가 직접 입력한 제보' });

let downP = null;
function syncDown(force) {
  if (!remoteOn()) return Promise.resolve(false);
  if (downP && !force) return downP;
  return downP = (async () => {
    try {
      const d = await apiCall('GET', '/api/me/data', undefined, true, 6000);
      const keep = k => store.get(k, []).filter(x => !x.remote);                    // 아직 못 올린 것은 지우지 않는다
      store.set(KEY.report, [...keep(KEY.report), ...d.reports.map(fromServerReport)]);
      store.set(KEY.recent, [...keep(KEY.recent), ...d.recents.map(fromServerRecent)].slice(0, 10));
      return true;
    } catch (e) {
      if (e.status === 401 && typeof Account !== 'undefined') { Account.clearSession(); flash('로그인이 만료됐어요. 다시 로그인해 주세요'); }
      return false;                                                                  // 네트워크 오류면 이 기기의 복사본 그대로
    }
  })();
}
async function syncUp() {
  if (!remoteOn()) return null;
  const strip = ({ remote, id, ...x }) => x;
  const reports = getReports().filter(r => !r.remote).map(({ segmentId, remote, ...x }) => x);
  const recents = getRecent().filter(r => !r.remote).map(strip);
  if (!reports.length && !recents.length) return null;
  try {
    const r = await apiCall('POST', '/api/me/import', { reports, recents }, true, 10000);
    store.set(KEY.report, getReports().filter(x => x.remote)); store.set(KEY.recent, getRecent().filter(x => x.remote));   // 올린 것은 곧이어 서버 것으로 바뀐다
    downP = null; await syncDown(true);
    return r;
  } catch { return null; }                                                           // 못 올렸으면 그대로 두고 다음에 다시
}
const failToast = msg => { if (typeof toast === 'function') toast(msg); };

/* 최근 검색 : 위험 구간 검색어 (최대 10건, 최신순) */
function pushRecent(row, body) {
  const list = getRecent().filter(r => r.kind === row.kind && (row.kind === 'route' ? r.origin === row.origin && r.destination === row.destination : r.q === row.q) ? false : true);
  list.unshift(row); store.set(KEY.recent, list.slice(0, 10));
  if (!remoteOn()) return;
  apiCall('POST', '/api/recents', body, true).then(r => {                            // 서버가 정한 id 로 바꾼다
    store.set(KEY.recent, getRecent().map(x => x.id === row.id ? { ...x, id: r.id, remote: true } : x));
  }).catch(() => {});                                                                // 못 올리면 remote 표시 없이 남아 다음 동기화 때 올라간다
}
function addRecent(q) { pushRecent({ id: uid('rc'), kind: 'keyword', q, at: nowText() }, { kind: 'keyword', q }); }
/* 최근 검색 : 경로 (출발 → 도착) */
function addRecentRoute(o, d) { pushRecent({ id: uid('rc'), kind: 'route', origin: o, destination: d, at: nowText() }, { kind: 'route', origin: o, destination: d }); }

/* 경로 즐겨찾기 */
const routeFavMatch = (f, o, d) => f.kind === 'route' && f.origin === o && f.destination === d;
const isRouteFav = (o, d) => getFavs().some(f => routeFavMatch(f, o, d));
function toggleRouteFav(o, d) {
  let favs = getFavs();
  const on = favs.some(f => routeFavMatch(f, o, d));
  if (on) favs = favs.filter(f => !routeFavMatch(f, o, d));
  else favs.unshift({ id: uid('fv'), kind: 'route', origin: o, destination: d, savedAt: nowText().slice(0, 5) });
  store.set(KEY.fav, favs); return !on;
}

/* 제보 수정 (서버에 있는 제보면 서버도 고친다. 실패하면 알리고, 새로고침하면 서버 상태로 돌아간다) */
async function updateReport(id, patch) {
  const list = getReports().map(r => {
    if (r.segmentId !== id) return r;
    const n = { ...r, ...patch, updatedAt: nowText() };
    n.meta = { ...r.meta, user: ['roadName', 'riskLevel', 'address', ...(n.accidentCount == null ? [] : ['accidentCount'])] };
    return n;
  });
  store.set(KEY.report, list);
  const row = list.find(r => r.segmentId === id);
  if (remoteOn() && row && row.remote) {
    try { await apiCall('PUT', `/api/reports/${encodeURIComponent(id)}`, { roadName: row.roadName, address: row.address, riskLevel: row.riskLevel, accidentCount: row.accidentCount }, true); }
    catch (e) { failToast('서버에 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요'); return false; }
  } else if (remoteOn()) await syncUp();
  return true;
}

/* 항목 지우기 : kind = fav(이 기기) | recent | report */
async function removeItem(kind, id) {
  const key = { fav: KEY.fav, recent: KEY.recent, report: KEY.report }[kind];
  const idOf = x => x.id || x.segmentId, row = store.get(key, []).find(x => idOf(x) === id);
  store.set(key, store.get(key, []).filter(x => idOf(x) !== id));
  if (kind === 'fav' || !remoteOn() || !row || !row.remote) return true;
  try { await apiCall('DELETE', `/api/${kind === 'report' ? 'reports' : 'recents'}/${encodeURIComponent(id)}`, undefined, true); return true; }
  catch { failToast('서버에서 지우지 못했어요. 새로고침하면 다시 보일 수 있어요'); return false; }
}
async function clearRecent() {
  store.set(KEY.recent, []);
  if (remoteOn()) try { await apiCall('DELETE', '/api/recents', undefined, true); } catch { failToast('서버에서 지우지 못했어요'); }
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
      const { remote, ...clean } = x; x = clean;                                   // 다른 기기에서 내려받은 '서버에 있음' 표시는 버린다
      if (!idOf(x)) x = { ...x, id: uid('im') };
      if (have.has(idOf(x))) { res.skipped++; return; }
      cur.push(x); have.add(idOf(x)); n++;
    });
    store.set(d.key, cur); res.added[name] = n;
  });
  return res;
}
async function clearUserData() {
  Object.values(USER_DATASETS).forEach(d => store.set(d.key, []));
  if (remoteOn()) try { await apiCall('DELETE', '/api/me/data', undefined, true); } catch { failToast('서버의 제보·검색 기록은 지우지 못했어요'); }
}

/* 사용자 제보 저장 — 로그인(회원 서버) 중이면 서버 DB 에 저장하고 서버가 정한 id 를 쓴다. 아니면(또는 서버가 안 될 때) 이 기기에만 저장하고 나중에 올린다 */
async function addReport(r) {
  const base = { ...r, source: 'user', createdAt: nowText(), meta: userMeta(r.accidentCount) };
  let row = null;
  if (remoteOn()) {
    try { row = fromServerReport((await apiCall('POST', '/api/reports', { roadName: r.roadName, address: r.address, riskLevel: r.riskLevel, accidentCount: r.accidentCount }, true)).report); }
    catch (e) { if (e.status && e.status < 500 && e.code !== 'unauthorized') throw e; failToast('서버에 저장하지 못해 이 기기에 먼저 저장했어요. 연결되면 자동으로 올라가요'); }
  }
  if (!row) row = { segmentId: uid('user-'), ...base };
  store.set(KEY.report, [row, ...getReports()]);
  return row;
}

/* 저장 형식 번호 (v0.5 = 1 → v0.6 = 2: 제보·최근 검색의 복사본에 remote 표시가 생겼다. 옛 항목은 remote 표시가 없어 로그인하면 계정으로 올라간다) */
try { if (store.get(KEY.schema) !== SCHEMA) store.set(KEY.schema, SCHEMA); } catch {}
