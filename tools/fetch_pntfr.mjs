/* fetch_pntfr.mjs — 국토교통부 사고다발지점 조회 서비스(ACDNT_PNTFR)에서 서울 사고다발지점과 지점별 개별 사고를 받아 data/ 에 저장한다.
   사용:  set SERVICE_KEY=일반인증키(Decoding)   set POINT_PATH=/지점목록서비스경로   node tools/fetch_pntfr.mjs [기준년도]
   - 키는 환경변수로만 받는다 (파일·저장소에 쓰지 않는다).
   - 지점별 결과는 data/raw_pntfr/ 에 한 건씩 저장해 두고, 다시 실행하면 이미 받은 지점은 건너뛴다 (일일 호출 한도 대비).
   - 좌표(acdnt_pnt_x/y)는 TM 좌표(중부원점, 가로 200000·세로 500000 기준)로 보고 위경도로 바꾼다. 샘플 한 건(강남역사거리 117M 지점)으로만 맞춰 본 추정이므로 README의 '확인 필요' 항목이다. */
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.SERVICE_KEY, POINT_PATH = process.env.POINT_PATH, YEAR = process.argv[2] || '2024';
const BASE = 'https://apis.data.go.kr/1613000/ACDNT_PNTFR';
const ACC_PATH = '/T_OD_ACDNT_PNTFR_ACDNT_INFO';
if (!KEY) { console.error('SERVICE_KEY 환경변수에 인증키(일반 인증키 Decoding)를 넣어 주세요.'); process.exit(1); }
if (POINT_PATH && !/^\/[A-Za-z0-9_\-\/]+$/.test(POINT_PATH)) { console.error('POINT_PATH가 올바른 경로 모양이 아니에요. 예시 문구(한글)를 그대로 넣은 것은 아닌지 확인해 주세요: ' + POINT_PATH); process.exit(1); }
if (!POINT_PATH) { console.error('POINT_PATH 환경변수에 지점 목록 서비스의 경로(예: /T_OD_…)를 넣어 주세요. Swagger 응답의 Request URL에서 /1613000/ACDNT_PNTFR 뒤의 부분입니다.'); process.exit(1); }
const DATA = path.resolve(import.meta.dirname, '../data'), RAW = path.join(DATA, 'raw_pntfr');
fs.mkdirSync(RAW, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* TM(중부원점, 베셀→WGS84이 아닌 GRS80 기준 F.E.200000 F.N.500000) → 위경도 */
function tmToLatLng(x, y) {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2), lat0 = 38 * Math.PI / 180, lon0 = 127 * Math.PI / 180, k0 = 1, fe = 200000, fn = 500000;
  const M = p => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const mu = (M(lat0) + (y - fn) / k0) / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = ep2 * Math.cos(p1) ** 2, R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = (x - fe) / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / Math.cos(p1);
  return [+(lat * 180 / Math.PI).toFixed(6), +(lon * 180 / Math.PI).toFixed(6)];
}

const lower = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
async function call(p, params) {
  const url = `${BASE}${p}?` + new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '1000', resultType: 'json', ...params });
  const res = await fetch(url); const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`JSON이 아닌 응답 (HTTP ${res.status}): ${text.slice(0, 160).replace(KEY, '***')}`); }
  const r = j.response || j, code = r.header?.resultCode;
  if (code === undefined) throw new Error(`예상과 다른 응답이에요 (HTTP ${res.status}) 주소 경로가 맞는지 확인해 주세요: ${p}\n응답: ${text.slice(0, 300).replace(KEY, '***')}`);
  if (code !== '00') { const e = new Error(`API 오류 ${code} ${r.header?.resultMsg || ''}`); e.code = code; throw e; }
  const it = r.body?.items?.item ?? r.body?.items ?? [];
  return (Array.isArray(it) ? it : it ? [it] : []).filter(x => x && typeof x === 'object').map(lower);
}

/* 1) 지점 목록: 서울 전체 (전체사고 · 중상이상사고) */
const points = new Map();
for (const se of ['전체사고', '중상이상사고']) {
  const rows = await call(POINT_PATH, { crtr_yr: YEAR, brnch_se_nm: se, mtrpl_lcgv_nm: '서울' });
  console.log(`지점 목록 ${se}: ${rows.length}건`);
  rows.forEach(r => points.set(`${r.basic_lcgv_nm}|${r.plc_nm}|${r.brnch_se_nm}`, r));
  await sleep(200);
}

/* 2) 지점별 개별 사고 (이미 받은 지점은 건너뜀) */
let n = 0, done = 0;
for (const [k, p] of points) {
  const file = path.join(RAW, Buffer.from(k).toString('hex').slice(0, 120) + '.json');
  n++;
  if (fs.existsSync(file)) { done++; continue; }
  try {
    const acc = await call(ACC_PATH, { crtr_yr: YEAR, brnch_se_nm: p.brnch_se_nm, mtrpl_lcgv_nm: '서울', basic_lcgv_nm: p.basic_lcgv_nm, plc_nm: p.plc_nm });
    fs.writeFileSync(file, JSON.stringify(acc)); done++;
    process.stdout.write(`\r개별 사고 ${done}/${points.size} 지점`);
  } catch (e) { console.error(`\n중단: ${e.message}\n(받은 만큼 저장돼 있으니, 호출 한도가 풀린 뒤 다시 실행하면 이어서 받습니다)`); break; }
  await sleep(150);
}
console.log();

/* 3) 합쳐서 저장 */
const KEYS = { dcsd_cnt: 'death', srs_inry_cnt: 'serious', min_inry_cnt: 'minor', inry_cnt: 'injured' };
const out = [];
for (const [k, p] of points) {
  const file = path.join(RAW, Buffer.from(k).toString('hex').slice(0, 120) + '.json');
  const acc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const [lat, lng] = tmToLatLng(p.acdnt_pnt_x, p.acdnt_pnt_y);
  const types = {}, sum = { death: 0, serious: 0, minor: 0, injured: 0 };
  (acc || []).forEach(a => { const t = [a.acdnt_lclsf, a.acdnt_sclsf].filter(Boolean).join(' · ') || '정보 없음'; types[t] = (types[t] || 0) + 1; for (const [f, g] of Object.entries(KEYS)) sum[g] += Number(a[f]) || 0; });
  out.push({ year: p.crtr_yr, kind: p.brnch_se_nm, gu: p.basic_lcgv_nm, name: p.plc_nm, count: p.ocrn_nocs, deaths: p.dth_nocs, index: p.cnsld_index, x: p.acdnt_pnt_x, y: p.acdnt_pnt_y, lat, lng,
    detail: acc ? { accidents: acc.length, types, ...sum } : null });
}
fs.writeFileSync(path.join(DATA, 'pntfr_points.json'), JSON.stringify(out, null, 1));
console.log(`data/pntfr_points.json 저장 (${out.length}지점, 개별 사고를 받은 지점 ${out.filter(o => o.detail).length}곳)`);
