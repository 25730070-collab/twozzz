/* storage.js — LocalStorage (사용자 상태 전용: 즐겨찾기 · 최근검색 · 연습기록 · 가입 정보) */
const KEY = { recent: 'sd_recent', fav: 'sd_favorites', drill: 'sd_drills', user: 'sd_user' };

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

const getRecent = () => store.get(KEY.recent, RECENT_SEED);
const getFavs = () => store.get(KEY.fav, FAV_SEED);
const getDrills = () => store.get(KEY.drill, DRILL_SEED);

const nowText = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function addRecent(origin, destination) {
  const list = getRecent().filter(r => !(r.origin === origin && r.destination === destination));
  list.unshift({ id: 'rc' + Date.now(), origin, destination, at: nowText() });
  store.set(KEY.recent, list.slice(0, 10));            // 최대 10건, 최신순
}

function addDrill(origin, destination, routeType, points) {
  const list = getDrills();
  list.unshift({ id: 'dr' + Date.now(), origin, destination, routeType, points, at: nowText() });
  store.set(KEY.drill, list.slice(0, 30));
}
