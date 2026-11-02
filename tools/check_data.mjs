// 데이터 검수: node tools/check_data.mjs  (JSON 100건 + API 200건 = 300건, 필드·자료형·플래그 통일)
import { readFileSync } from 'node:fs';
const load = f => JSON.parse(readFileSync(f, 'utf8'));
const allRows = ['data/segments_static.json', 'data/segments_api.json'].flatMap(f => load(f));   // 등급은 수집 데이터의 사분위수 기준(상대 등급) — 사고 건수가 많을수록 등급이 낮아지면 안 됨
const FIELDS = { segmentId:'string', roadName:'string', accidentCount:'number', riskLevel:'number', address:'string', lat:'number', lng:'number', year:'number', source:'string', meta:'object' };
const OPTIONAL = ['casualtyCount','deathCount','seriousCount','minorCount','injuryReportCount'];   // 응답에 있을 때만 들어가는 실제 부가 필드
let bad = 0;
const sigOf = r => `${r.address}|${r.lat}|${r.lng}`; const seenSig = new Map(); const seenId = new Map(); const fail = m => { bad++; console.log('✗', m); };
for (const [file, name, src, min] of [['data/segments_static.json','static 데이터','static',100],['data/segments_api.json','api 데이터','api',200]]) {
  const rows = load(file), ids = new Set();
  console.log(`${name}: ${rows.length}건 (기준 ${min}건 이상)`);
  if (rows.length < min) fail(`${name} ${rows.length}건 < ${min}건`);
  rows.forEach((r, i) => {
    for (const [k, t] of Object.entries(FIELDS)) if (typeof r[k] !== t) fail(`${name}[${i}].${k} 자료형 ${typeof r[k]} (기대 ${t})`);
    Object.keys(r).forEach(k => { if (!(k in FIELDS) && !OPTIONAL.includes(k)) fail(`${name}[${i}] 정의되지 않은 필드: ${k}`); });
    OPTIONAL.forEach(k => { if (k in r && typeof r[k] !== 'number') fail(`${name}[${i}].${k} 자료형`); });
    if (!r.meta || r.meta.source !== (src === 'static' ? 'json' : 'api') || !Array.isArray(r.meta.real) || !Array.isArray(r.meta.dummy)) fail(`${name}[${i}] meta(source·real·dummy) 이상`);
    if (r.source !== src) fail(`${name}[${i}] source=${r.source}`);
    if (![1, 2, 3, 4].includes(r.riskLevel)) fail(`${name}[${i}] riskLevel=${r.riskLevel}`);
    if (allRows.some(o => o.accidentCount > r.accidentCount && o.riskLevel < r.riskLevel)) fail(`${name}[${i}] riskLevel 순서 불일치(사고 건수 대비)`);
    if (r.meta && r.meta.dummy && r.meta.dummy.length) fail(`${name}[${i}] 더미 필드 있음 (더미 데이터 금지): ${r.meta.dummy}`);
    if (seenSig.has(sigOf(r)) || seenId.has(r.segmentId)) fail(`${name}[${i}] 다른 파일/항목과 겹치는 구간: ${r.roadName}`); seenSig.set(sigOf(r), 1); seenId.set(r.segmentId, 1);
    if (ids.has(r.segmentId)) fail(`${name} segmentId 중복 ${r.segmentId}`); ids.add(r.segmentId);
  });
}
console.log(bad ? `\n문제 ${bad}건` : '\n검수 통과');
process.exit(bad ? 1 : 0);
