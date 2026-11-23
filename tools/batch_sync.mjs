/* batch_sync.mjs — 공공데이터(API) 구간을 DB(segments 표)와 비교해 늘고·줄고·바뀐 것을 알려 주는 배치 작업 (v0.6, 12주차)

   실행 예
     node tools/batch_sync.mjs --new data/segments_api.json --source api            # 비교만 (DB 는 건드리지 않는다)
     node tools/batch_sync.mjs --new data/segments_api.json --source api --apply    # 비교 뒤 DB 에 반영
     node tools/batch_sync.mjs --new 새로받은.json --old data/segments_api.json     # DB 없이 파일끼리 비교

   · --new   새로 받은 구간 JSON (tools/fetch_api.mjs 가 만든 파일과 같은 형식)
   · --old   비교 기준 파일. 없으면 DB 의 segments 표(해당 source)를 기준으로 한다
   · --apply DB 에 반영(upsert: 새 것은 넣고, 바뀐 것은 고치고, 없어진 것은 지운다) + batch_runs 에 기록. --old 와 같이 쓸 수 없다
   · --report 결과 보고서 파일 경로 (기본 data/batch_report.md)
   · DB 설정은 서버와 같은 환경변수(DB=sqlite|mysql, SQLITE_PATH, MYSQL_* ...)를 쓴다.

   ※ 화면(js/data.js)은 아직 data/*.json 을 직접 읽는다. 이 작업은 DB 의 segments 표를 최신으로 맞춰 두는 일을 하고,
      화면이 DB 를 읽게 바꾸는 것(API 로 구간 내려주기)은 다음 버전 과제다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const COMPARE = ['roadName', 'address', 'accidentCount', 'riskLevel', 'lat', 'lng', 'year'];

export function diffSegments(oldRows, newRows) {
  const o = new Map(oldRows.map(r => [r.segmentId, r])), n = new Map(newRows.map(r => [r.segmentId, r]));
  const added = [], removed = [], changed = [];
  for (const [id, r] of n) {
    if (!o.has(id)) { added.push(r); continue; }
    const diffs = COMPARE.filter(k => (o.get(id)[k] ?? null) !== (r[k] ?? null)).map(k => ({ field: k, from: o.get(id)[k] ?? null, to: r[k] ?? null }));
    if (diffs.length) changed.push({ segmentId: id, roadName: r.roadName, diffs });
  }
  for (const [id, r] of o) if (!n.has(id)) removed.push(r);
  return { added, removed, changed, unchanged: n.size - added.length - changed.length };
}

function validate(rows) {
  if (!Array.isArray(rows)) throw new Error('구간 목록(배열)이 아니에요');
  const bad = rows.filter(r => !r || !r.segmentId || !r.roadName || !r.address || ![1, 2, 3, 4].includes(r.riskLevel));
  if (bad.length) throw new Error(`형식이 맞지 않는 구간이 ${bad.length}건 있어요 (segmentId·roadName·address·riskLevel 1~4 필요). 첫 번째: ${JSON.stringify(bad[0]).slice(0, 100)}`);
  const ids = new Set(rows.map(r => r.segmentId));
  if (ids.size !== rows.length) throw new Error('segmentId 가 겹치는 구간이 있어요');
}

const fromDbRow = r => ({ ...JSON.parse(r.payload), segmentId: r.segment_id });

export function report({ source, total, d, applied, at }) {
  const L = [`# 배치 동기화 보고서`, '', `- 실행: ${new Date(at).toISOString()}`, `- 대상: ${source} 구간 · 새로 받은 ${total}건`, `- 반영 여부: ${applied ? '**DB 에 반영함**' : '비교만 함 (--apply 를 주면 반영)'}`, '',
    `| 구분 | 건수 |`, `|---|---:|`, `| 새로 늘어난 구간 | ${d.added.length} |`, `| 없어진 구간 | ${d.removed.length} |`, `| 내용이 바뀐 구간 | ${d.changed.length} |`, `| 그대로 | ${d.unchanged} |`, ''];
  if (d.added.length) L.push('## 늘어난 구간', ...d.added.slice(0, 30).map(r => `- ${r.segmentId} · ${r.roadName}`), d.added.length > 30 ? `- … 외 ${d.added.length - 30}건` : '', '');
  if (d.removed.length) L.push('## 없어진 구간', ...d.removed.slice(0, 30).map(r => `- ${r.segmentId} · ${r.roadName}`), d.removed.length > 30 ? `- … 외 ${d.removed.length - 30}건` : '', '');
  if (d.changed.length) L.push('## 바뀐 구간', ...d.changed.slice(0, 30).map(c => `- ${c.segmentId} · ${c.roadName}: ${c.diffs.map(x => `${x.field} ${x.from} → ${x.to}`).join(', ')}`), d.changed.length > 30 ? `- … 외 ${d.changed.length - 30}건` : '', '');
  return L.join('\n');
}

export async function applyToDb(db, source, newRows, d, at = Date.now()) {
  await db.transaction(async () => {
    for (const r of [...d.added, ...d.changed.map(c => newRows.find(x => x.segmentId === c.segmentId))]) {
      const vals = [r.roadName, r.address, r.accidentCount ?? null, r.riskLevel, r.lat ?? null, r.lng ?? null, r.year ?? null, JSON.stringify(r), at];
      const hit = await db.get('SELECT id FROM segments WHERE segment_id = ?', [r.segmentId]);
      if (hit) await db.run('UPDATE segments SET road_name=?, address=?, accident_count=?, risk_level=?, lat=?, lng=?, year=?, payload=?, updated_at=? WHERE id=?', [...vals, hit.id]);
      else await db.run('INSERT INTO segments (segment_id, source, road_name, address, accident_count, risk_level, lat, lng, year, payload, first_seen_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [r.segmentId, source, ...vals.slice(0, 8), at, at]);
    }
    for (const r of d.removed) await db.run('DELETE FROM segments WHERE segment_id = ? AND source = ?', [r.segmentId, source]);
    await db.run('INSERT INTO batch_runs (ran_at, source, total_new, added, removed, changed, applied) VALUES (?,?,?,?,?,?,1)', [at, source, newRows.length, d.added.length, d.removed.length, d.changed.length]);
  });
}

export async function main(argv, env = process.env) {
  const a = {}; for (let i = 0; i < argv.length; i++) { if (argv[i] === '--apply') a.apply = true; else if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; }
  if (!a.new) throw new Error('--new <새로 받은 JSON> 이 필요해요');
  if (a.apply && a.old) throw new Error('--apply 는 DB 를 기준으로만 쓸 수 있어요 (--old 와 같이 쓸 수 없어요)');
  const source = a.source || 'api';
  const newRows = JSON.parse(fs.readFileSync(a.new, 'utf8')); validate(newRows);
  let db = null, oldRows;
  if (a.old) { oldRows = JSON.parse(fs.readFileSync(a.old, 'utf8')); validate(oldRows); }
  else {
    const { openDb } = await import('../server/db.js');
    db = await openDb({ ...env, SQLITE_PATH: env.SQLITE_PATH || path.join(ROOT, 'server', 'dev.sqlite') });
    oldRows = (await db.all('SELECT segment_id, payload FROM segments WHERE source = ?', [source])).map(fromDbRow);
  }
  const d = diffSegments(oldRows, newRows), at = Date.now();
  let applied = false;
  if (a.apply) { await applyToDb(db, source, newRows, d, at); applied = true; }
  const text = report({ source, total: newRows.length, d, applied, at });
  const out = a.report || path.join(ROOT, 'data', 'batch_report.md'); fs.writeFileSync(out, text);
  if (db && db.close) await db.close();
  return { d, applied, out, text };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(r => console.log(r.text.split('\n').slice(0, 12).join('\n') + `\n\n보고서: ${r.out}`)).catch(e => { console.error('실패:', e.message); process.exit(1); });
}
