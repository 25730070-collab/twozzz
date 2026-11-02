// 도로교통공단 지자체별 교통사고 다발지역 OpenAPI(실제 공공데이터) →
//   data/segments_static.json  : 저장 JSON 100건 (source: "static", J)
//   data/segments_api.json     : 위 100건에 없는 나머지 (source: "api", A) — 두 파일에 겹치는 구간 없음
// 더미 데이터는 사용하지 않는다.
// 사용법:  SERVICE_KEY=공공데이터포털_인증키 node tools/fetch_api.mjs
// 선택:    YEARS=2019,2020,2021,2022,2023  OUT=data/segments_api.json  ENDPOINT=...  (Node 18 이상)
// 서울 25개 구를 구 단위로 돌며 전부 모은 뒤 project 필드 구조로 변환한다.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENDPOINT = process.env.ENDPOINT || 'https://apis.data.go.kr/B552061/frequentzoneLg/getRestFrequentzoneLg';
const YEARS = (process.env.YEARS || process.env.YEAR || '2019,2020,2021,2022,2023').split(',').map(s => s.trim());   // 여러 해를 합쳐 200건 이상 확보
const OUT = process.env.OUT || 'data/segments_api.json';
const GUGUN = ['110','140','170','200','215','230','260','290','305','320','350','380','410','440','470','500','530','545','560','590','620','650','680','710','740'];

export const level = n => n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1;
const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
// 응답에 있으면 그대로 쓰는 실제 부가 필드 (없으면 null → 화면에서 숨김). 필드명은 첫 응답의 키 목록(콘솔 출력)과 비교해 확인할 것
export const EXTRA = { casualtyCount: 'caslt_cnt', deathCount: 'dth_dnv_cnt', seriousCount: 'se_dnv_cnt', minorCount: 'sl_dnv_cnt', injuryReportCount: 'wnd_dnv_cnt' };

export function mapItem(it, year = '', src = 'api') {
  const prefix = (it.sido_sgg_nm || '').replace(/\d+$/, '').trim();       // "서울특별시 강동구"
  const name = String(it.spot_nm || '').replace(prefix, '').trim();        // "천호동(천호초교입구 부근)"
  const row = {
    segmentId: `${src === 'static' ? 'seg' : 'api'}-${year}-${it.spot_cd}`,
    roadName: name,
    accidentCount: Number(it.occrrnc_cnt),
    riskLevel: 0,                                                           // splitDatasets()에서 계산
    address: String(it.spot_nm || '').trim(),
    lat: Number(it.la_crd),
    lng: Number(it.lo_crd),
    year: Number(year),
  };
  const extra = {}; let has = [];
  for (const [k, f] of Object.entries(EXTRA)) { const v = num(it[f]); if (v !== null) { extra[k] = v; has.push(k); } }
  return { ...row, ...extra, source: src, _extra: has };
}

const itemsOf = j => {
  const body = j?.response?.body ?? j;
  const raw = body?.items?.item ?? body?.items ?? [];
  return { list: Array.isArray(raw) ? raw : [raw], total: Number(body?.totalCount ?? 0) };
};

async function main() {
  const key = process.env.SERVICE_KEY;
  if (!key) { console.error('SERVICE_KEY 환경변수가 필요합니다.'); process.exit(1); }
  const k = key.includes('%') ? key : encodeURIComponent(key);
  const seen = new Map(); let sampleSaved = false;
  for (const year of YEARS) {
    const before = seen.size;
    for (const gu of GUGUN) {
      for (let page = 1; ; page++) {
        const url = `${ENDPOINT}?ServiceKey=${k}&searchYearCd=${year}&siDo=11&guGun=${gu}&type=json&numOfRows=100&pageNo=${page}`;
        const res = await fetch(url);
        const text = await res.text();
        let j; try { j = JSON.parse(text); } catch { console.error(`${year}년 구 ${gu}: JSON이 아닌 응답 →`, text.slice(0, 200)); break; }
        const { list, total } = itemsOf(j);
        if (!sampleSaved && list[0]) { sampleSaved = true; writeFileSync('data/api_sample.json', JSON.stringify(list.slice(0, 2).map(x => ({ ...x, geom_json: x.geom_json ? '(생략)' : x.geom_json })), null, 1)); console.log('API 응답 필드:', Object.keys(list[0]).join(', ')); }
        list.filter(x => x && x.spot_cd).forEach(x => seen.set(`${year}:${x.spot_cd}`, mapItem(x, year)));
        if (page * 100 >= total || list.length === 0) break;
      }
    }
    console.log(`${year}년 완료 — +${seen.size - before}건 (누적 ${seen.size}건)`);
  }
  const { J, A, th, total } = splitDatasets([...seen.values()]);
  console.log(`중복 제거 후 ${total}건 · riskLevel 기준(사고 건수 사분위수): 1등급 ≤${th[0]} / 2등급 ≤${th[1]} / 3등급 ≤${th[2]} / 4등급 그 이상`);
  const fmt = rows => '[\n' + rows.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n';
  writeFileSync('data/segments_static.json', fmt(J));
  writeFileSync(OUT, fmt(A));
  console.log(`data/segments_static.json 저장: ${J.length}건 (J)`);
  console.log(`${OUT} 저장: ${A.length}건 (A)` + (A.length < 200 || J.length < 100 ? ' ⚠ 기준(J 100 + A 200) 미달 — YEARS에 더 많은 해를 넣어 다시 실행' : ''));
}

/* 수집한 전체 레코드 → 중복 제거 → riskLevel 계산 → J(100건) / A(나머지) 분리 */
export function splitDatasets(rows, NJ = 100) {
  // 같은 장소(주소+좌표)가 여러 해에 나오면 가장 최근 해 1건만 남긴다 → 겹치는 구간 없음
  const yearOf = r => String(r.year || (String(r.segmentId).match(/-(\d{4})-/) || [])[1] || '0');
  const uniq = new Map();
  for (const v of rows) { const sig = `${v.address}|${v.lat}|${v.lng}`; const prev = uniq.get(sig); if (!prev || yearOf(v) > yearOf(prev)) uniq.set(sig, v); }
  const all = [...uniq.values()].filter(v => Number.isFinite(+v.lat) && Number.isFinite(+v.lng) && Number.isFinite(+v.accidentCount))
    .map(v => ({ ...v, lat: +v.lat, lng: +v.lng, accidentCount: +v.accidentCount }));
  all.sort((a, b) => b.accidentCount - a.accidentCount || String(a.segmentId).localeCompare(String(b.segmentId)));
  // 다발지역 데이터는 모두 사고 건수가 많아 고정 기준(10건↑=4등급)이면 전부 4등급이 된다 → 수집 데이터의 사분위수로 상대 등급을 매긴다
  const cnt = all.map(r => r.accidentCount).sort((a, b) => a - b), q = p => cnt[Math.floor(p * (cnt.length - 1))];
  const th = [q(.25), q(.5), q(.75)];
  const lv = n => n <= th[0] ? 1 : n <= th[1] ? 2 : n <= th[2] ? 3 : 4;
  const norm = (r, src) => {
    const { _extra = [], ...rest } = r;
    const extraKeys = Object.keys(EXTRA).filter(k => rest[k] !== undefined);
    return {
      segmentId: String(r.segmentId).replace(/^(api|seg)-/, src === 'static' ? 'seg-' : 'api-'),
      roadName: rest.roadName, accidentCount: rest.accidentCount, ...Object.fromEntries(extraKeys.map(k => [k, rest[k]])),
      riskLevel: lv(rest.accidentCount), address: rest.address, lat: rest.lat, lng: rest.lng, year: rest.year, source: src,
      meta: { source: src === 'static' ? 'json' : 'api', real: ['roadName', 'accidentCount', ...extraKeys, 'address', 'lat', 'lng', 'year'], derived: ['riskLevel'], dummy: [], api: [],
        note: `한국도로교통공단 지자체별 교통사고 다발지역 ${rest.year}년 · riskLevel은 사고 건수 사분위수(≤${th[0]}/≤${th[1]}/≤${th[2]}/그 이상)로 계산한 상대 등급` }
    };
  };
  const n = Math.min(NJ, all.length), pick = new Set();
  for (let i = 0; i < n; i++) pick.add(Math.floor(i * all.length / n));       // 사고 건수 순 목록에서 고르게 → 등급이 섞임
  return { J: all.filter((_, i) => pick.has(i)).map(r => norm(r, 'static')), A: all.filter((_, i) => !pick.has(i)).map(r => norm(r, 'api')), th, total: all.length };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
