import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffSegments, main } from '../tools/batch_sync.mjs';

const seg = (id, o = {}) => ({ segmentId: id, roadName: '도로' + id, address: '서울 ' + id, accidentCount: 10, riskLevel: 2, lat: 37.5, lng: 127, year: 2023, source: 'api', ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdbatch-'));
const w = (n, v) => { const f = path.join(tmp, n); fs.writeFileSync(f, JSON.stringify(v)); return f; };

test('diff: 늘고·줄고·바뀐 것을 구분한다 (null 과 undefined 는 같다)', () => {
  const d = diffSegments([seg('a'), seg('b'), seg('c', { year: undefined })], [seg('a'), seg('b', { riskLevel: 4 }), seg('c', { year: null }), seg('d')]);
  assert.equal(d.added.length, 1); assert.equal(d.removed.length, 0); assert.equal(d.changed.length, 1); assert.equal(d.unchanged, 2);
  assert.deepEqual(d.changed[0].diffs, [{ field: 'riskLevel', from: 2, to: 4 }]);
  assert.equal(diffSegments([seg('x')], []).removed.length, 1);
});

test('파일끼리 비교: 보고서를 쓰고 DB 는 안 건드린다', async () => {
  const r = await main(['--old', w('o.json', [seg('a'), seg('b')]), '--new', w('n.json', [seg('a'), seg('c')]), '--report', path.join(tmp, 'r.md')]);
  assert.equal(r.applied, false); assert.equal(r.d.added.length, 1); assert.equal(r.d.removed.length, 1);
  assert.match(fs.readFileSync(r.out, 'utf8'), /새로 늘어난 구간 \| 1/);
});

test('--apply: DB 에 넣고, 다시 돌리면 변화 0, 바꾸면 수정·삭제, 실행 기록이 남는다', async () => {
  const env = { DB: 'sqlite', SQLITE_PATH: path.join(tmp, 't.sqlite') };
  const run = (rows, extra = []) => main(['--new', w('x.json', rows), '--report', path.join(tmp, 'r2.md'), ...extra], env);
  let r = await run([seg('a'), seg('b')], ['--apply']);
  assert.equal(r.d.added.length, 2);
  r = await run([seg('a'), seg('b')], ['--apply']);
  assert.equal(r.d.added.length + r.d.changed.length + r.d.removed.length, 0);
  r = await run([seg('a', { accidentCount: 99 }), seg('c')], ['--apply']);
  assert.deepEqual([r.d.added.length, r.d.removed.length, r.d.changed.length], [1, 1, 1]);
  const { openDb } = await import('../server/db.js'); const db = await openDb(env);
  const rows = await db.all('SELECT segment_id, accident_count FROM segments ORDER BY segment_id');
  assert.deepEqual(rows, [{ segment_id: 'a', accident_count: 99 }, { segment_id: 'c', accident_count: 10 }]);
  assert.equal((await db.all('SELECT * FROM batch_runs')).length, 3);
  r = await run([seg('a', { accidentCount: 1 })]);
  assert.equal(r.applied, false); assert.equal((await db.get('SELECT accident_count n FROM segments WHERE segment_id = ?', ['a'])).n, 99);   // --apply 없이는 DB 가 그대로
});

test('형식이 틀린 파일·잘못된 옵션은 오류', async () => {
  await assert.rejects(main(['--old', w('o2.json', []), '--new', w('bad.json', [{ segmentId: 'z' }])]), /형식이 맞지 않는/);
  await assert.rejects(main(['--old', w('o3.json', []), '--new', w('d.json', [seg('a'), seg('a')])]), /겹치는/);
  await assert.rejects(main(['--new', w('e.json', []), '--old', w('o4.json', []), '--apply']), /--old 와 같이/);
});

test('실제 data/segments_api.json 이 형식 검사를 통과하고 자기 자신과는 차이가 없다', async () => {
  const f = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'segments_api.json');
  const r = await main(['--old', f, '--new', f, '--report', path.join(tmp, 'r3.md')]);
  assert.equal(r.d.unchanged, JSON.parse(fs.readFileSync(f, 'utf8')).length);
});
