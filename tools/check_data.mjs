// 데이터 검수: node tools/check_data.mjs  (정적 300건+, API 100건+, 필드·자료형·플래그 통일)
import { readFileSync } from 'node:fs';
const load = f => JSON.parse(readFileSync(f, 'utf8'));
const level = n => n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1;
const FIELDS = { segmentId:'string', roadName:'string', roadType:'string', accidentCount:'number', riskLevel:'number', address:'string', lat:'number', lng:'number', source:'string' };
let bad = 0; const fail = m => { bad++; console.log('✗', m); };
for (const [file, name, src, min] of [['data/segments_static.json','static 데이터','static',300],['data/segments_api.json','api 데이터','api',100]]) {
  const rows = load(file), ids = new Set();
  console.log(`${name}: ${rows.length}건 (기준 ${min}건 이상)`);
  if (rows.length < min) fail(`${name} ${rows.length}건 < ${min}건`);
  rows.forEach((r, i) => {
    for (const [k, t] of Object.entries(FIELDS)) if (typeof r[k] !== t) fail(`${name}[${i}].${k} 자료형 ${typeof r[k]} (기대 ${t})`);
    if (Object.keys(r).length !== Object.keys(FIELDS).length) fail(`${name}[${i}] 필드 수 불일치`);
    if (r.source !== src) fail(`${name}[${i}] source=${r.source}`);
    if (r.riskLevel !== level(r.accidentCount)) fail(`${name}[${i}] riskLevel 규칙 불일치`);
    if (!['대로','이면도로','골목길'].includes(r.roadType)) fail(`${name}[${i}] roadType=${r.roadType}`);
    if (ids.has(r.segmentId)) fail(`${name} segmentId 중복 ${r.segmentId}`); ids.add(r.segmentId);
  });
}
console.log(bad ? `\n문제 ${bad}건` : '\n검수 통과');
process.exit(bad ? 1 : 0);
