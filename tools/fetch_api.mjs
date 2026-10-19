// 도로교통공단 사고다발지역정보 OpenAPI → data/segments_api.json (source: "api")
// 사용법:  SERVICE_KEY=공공데이터포털_인증키 node tools/fetch_api.mjs
// 선택:    YEAR=2023  OUT=data/segments_api.json  ENDPOINT=...  (Node 18 이상)
// 서울 25개 구를 구 단위로 돌며 전부 모은 뒤 project 필드 구조로 변환한다.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENDPOINT = process.env.ENDPOINT || 'https://apis.data.go.kr/B552061/frequentzoneLg/getRestFrequentzoneLg';
const YEAR = process.env.YEAR || '2023';
const OUT = process.env.OUT || 'data/segments_api.json';
const GUGUN = ['110','140','170','200','215','230','260','290','305','320','350','380','410','440','470','500','530','545','560','590','620','650','680','710','740'];

export const level = n => n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1;
export const roadTypeOf = name => /대로|로(\s|\(|$)/.test(name) ? '대로' : '이면도로'; // API에 도로유형이 없어 이름으로 추정

export function mapItem(it) {
  const prefix = (it.sido_sgg_nm || '').replace(/\d+$/, '').trim();       // "서울특별시 강동구"
  const name = String(it.spot_nm || '').replace(prefix, '').trim();        // "천호동(천호초교입구 부근)"
  const accidentCount = Number(it.occrrnc_cnt);
  return {
    segmentId: `api-${it.spot_cd}`,
    roadName: name,
    roadType: roadTypeOf(name),
    accidentCount,
    riskLevel: level(accidentCount),
    address: String(it.spot_nm || '').trim(),
    lat: Number(it.la_crd),
    lng: Number(it.lo_crd),
    source: 'api',
  };
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
  const seen = new Map();
  for (const gu of GUGUN) {
    for (let page = 1; ; page++) {
      const url = `${ENDPOINT}?ServiceKey=${k}&searchYearCd=${YEAR}&siDo=11&guGun=${gu}&type=json&numOfRows=100&pageNo=${page}`;
      const res = await fetch(url);
      const text = await res.text();
      let j; try { j = JSON.parse(text); } catch { console.error(`구 ${gu}: JSON이 아닌 응답 →`, text.slice(0, 200)); break; }
      const { list, total } = itemsOf(j);
      list.filter(x => x && x.spot_cd).forEach(x => seen.set(x.spot_cd, mapItem(x)));
      if (page * 100 >= total || list.length === 0) break;
    }
    console.log(`구 ${gu} 완료 — 누적 ${seen.size}건`);
  }
  const rows = [...seen.values()];
  writeFileSync(OUT, '[\n' + rows.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n');
  console.log(`${OUT} 저장: ${rows.length}건` + (rows.length < 100 ? ' ⚠ 100건 미만 — YEAR를 바꿔 다시 실행' : ''));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
