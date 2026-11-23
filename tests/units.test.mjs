/* units.test.mjs — 브라우저 없이 계산만 확인 (navinfo.js · tools/build_cameras.mjs).  실행: npm run test:unit */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeText, parseCsv, mapRecords, build } from '../tools/build_cameras.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 브라우저용 스크립트(전역 함수)를 한 공간에 불러온다 */
const ctx = vm.createContext({ console, Intl });
for (const f of ['geo.js', 'navinfo.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
const arr = x => Array.from(x);                                   // 다른 공간(vm)에서 만든 배열을 이쪽 배열로 (deepEqual 이 공간이 다르면 다르다고 본다)
const N = vm.runInContext('({ remainSec, fmtDur, trafficSegs, hasTraffic, snapToRoute, camsOnRoute, nextCam, speedLevel, trafficOf, densify, cumulative })', ctx);

/* 동서로 곧게 뻗은 3km 경로 (위도 37.5) 와 도로 3개 */
const path3 = (() => { const p = []; for (let i = 0; i <= 30; i++) p.push([37.5, 127 + i * 0.00113]); return p; })();
const route = (roads, extra = {}) => { const p = N.densify(path3, 40), cum = N.cumulative(p); return { path: p, cum, dur: 600, roads, ...extra }; };

test('남은 시간: 도로별 소요 시간 합으로 계산한다', () => {
  const r0 = route([]); const T = r0.cum[r0.cum.length - 1];
  const r = route([{ at: 0, dur: 100, st: 4 }, { at: T / 3, dur: 300, st: 1 }, { at: 2 * T / 3, dur: 200, st: 3 }]);
  assert.equal(Math.round(N.remainSec(r, 0)), 600);
  assert.equal(Math.round(N.remainSec(r, T / 3)), 500);
  assert.equal(Math.round(N.remainSec(r, T / 3 + T / 6)), 350);       // 정체 도로 한가운데 = 150 + 200
  assert.equal(Math.round(N.remainSec(r, T)), 0);
  assert.equal(Math.round(N.remainSec(r, T * 2)), 0);                 // 끝을 넘어도 0
});
test('남은 시간: 도로별 합이 전체 소요 시간과 달라도 전체에 맞춘다', () => {
  const r0 = route([]); const T = r0.cum[r0.cum.length - 1];
  const r = route([{ at: 0, dur: 100, st: 4 }, { at: T / 2, dur: 100, st: 4 }], { dur: 1000 });     // 합 200 ≠ 1000
  assert.equal(Math.round(N.remainSec(r, 0)), 1000);
  assert.equal(Math.round(N.remainSec(r, T / 2)), 500);
});
test('남은 시간: 도로 정보가 없거나 일부만 있으면 거리 비율로 어림한다', () => {
  const r0 = route([]); const T = r0.cum[r0.cum.length - 1];
  assert.equal(Math.round(N.remainSec(r0, T / 4)), 450);
  assert.equal(Math.round(N.remainSec(route([{ at: 0, st: 4 }]), T / 2)), 300);                     // 소요 시간 값이 없는 도로
  assert.equal(Math.round(N.remainSec(route([{ at: 0, dur: 50 }, { at: T / 2, st: 1 }]), T / 2)), 300);
  assert.equal(Math.round(N.remainSec({ ...r0, dur: undefined, minutes: 10 }, 0)), 600);            // dur 가 없으면 minutes 로
});
test('시간 · 시각 표기', () => {
  assert.equal(N.fmtDur(20), '1분 미만'); assert.equal(N.fmtDur(61), '1분'); assert.equal(N.fmtDur(754), '13분');
  assert.equal(N.fmtDur(3600), '1시간'); assert.equal(N.fmtDur(3900), '1시간 5분'); assert.equal(N.fmtDur(NaN), '-');
});
test('교통 막대 구간: 같은 상태는 합치고 정보 없는 상태는 0 으로', () => {
  const r0 = route([]); const T = r0.cum[r0.cum.length - 1];
  const r = route([{ at: 0, st: 4 }, { at: T * .2, st: 4 }, { at: T * .4, st: 1 }, { at: T * .6, st: 9 }, { at: T * .8, st: undefined }]);
  const g = N.trafficSegs(r);
  assert.deepEqual(arr(g.map(x => x.st)), [4, 1, 0]);                      // 4+4 합침 · 1 · (9 와 undefined 는 모두 정보 없음 0 으로 합침)
  assert.equal(g[0].from, 0); assert.ok(Math.abs(g[0].to - T * .4) < 1e-6); assert.ok(Math.abs(g[2].to - T) < 1e-6);
  assert.ok(N.hasTraffic(r)); assert.ok(!N.hasTraffic(route([{ at: 0, st: 0 }, { at: 5, st: undefined }]))); assert.ok(!N.hasTraffic(route([])));
});
test('카메라 거리 : 꼭짓점 사이(최대 20m 떨어진 곳)에 있어도 경로 위로 정확히 잰다', () => {
  const p = [[37.5, 127.000], [37.5, 127.0023]], cum = N.cumulative(p);      // 약 204m 짜리 선분 하나
  const mid = [37.5, 127.00115];                                            // 선분 한가운데 (꼭짓점에서는 약 100m)
  const s = N.snapToRoute(p, cum, mid);
  assert.ok(s.dist < 1, `경로까지 ${s.dist}m`); assert.ok(Math.abs(s.along - cum[1] / 2) < 2);
  const off = N.snapToRoute(p, cum, [37.5 + 0.0009, 127.00115]);            // 약 100m 북쪽
  assert.ok(off.dist > 95 && off.dist < 105, `옆으로 ${off.dist}m`);
});
test('경로 위 카메라 고르기: 반경 안만, 경로 순서대로', () => {
  const r = route([]);
  const cams = [
    { id: 'b', lat: 37.5, lng: 127.02, limit: 50 },                         // 경로 위(뒤쪽)
    { id: 'a', lat: 37.5, lng: 127.005, limit: 60 },                        // 경로 위(앞쪽)
    { id: 'far', lat: 37.5009, lng: 127.01, limit: 30 },                    // 약 100m 옆
    { id: 'near', lat: 37.50018, lng: 127.012, limit: 40 },                 // 약 20m 옆 → 포함
    { id: 'out', lat: 37.6, lng: 127.5, limit: 80 }                         // 아주 멀리
  ];
  const got = N.camsOnRoute(r, cams, 35);
  assert.deepEqual(arr(got.map(x => x.cam.id)), ['a', 'near', 'b']);
  assert.ok(got.every((x, i) => i === 0 || got[i - 1].at <= x.at));
  assert.equal(N.camsOnRoute(r, null).length, 0); assert.equal(N.camsOnRoute(r, []).length, 0);
});
test('다음 카메라 / 속도 단계', () => {
  const list = [{ at: 1000 }, { at: 2500 }];
  assert.equal(N.nextCam(list, 0, 500), null);
  assert.equal(N.nextCam(list, 600, 500).at, 1000);
  assert.equal(N.nextCam(list, 1005, 500).at, 1000);                        // 지나가는 중(10m 이내)은 아직 표시
  assert.equal(N.nextCam(list, 1100, 500), null);                           // 지나갔고 다음은 멀다
  assert.equal(N.speedLevel(72, 60), 'over'); assert.equal(N.speedLevel(60, 60), 'near'); assert.equal(N.speedLevel(51, 60), 'near');
  assert.equal(N.speedLevel(50, 60), 'ok'); assert.equal(N.speedLevel(30, null), 'none'); assert.equal(N.speedLevel(null, 60), 'none'); assert.equal(N.speedLevel(0, 60), 'ok');
});

/* ---------- build_cameras.mjs ---------- */
test('CSV 읽기: 따옴표 · 쉼표 · 줄바꿈 · CRLF', () => {
  const t = parseCsv('a,b,c\r\n1,"x, y",3\r\n"줄\n바꿈","큰""따옴표",\r\n\r\n');
  assert.deepEqual(t, [['a', 'b', 'c'], ['1', 'x, y', '3'], ['줄\n바꿈', '큰"따옴표', '']]);
});
test('한글 윈도우 인코딩(CP949) 파일도 읽는다', () => {
  assert.equal(decodeText(Buffer.from([0xBC, 0xAD, 0xBF, 0xEF])), '서울');          // EUC-KR/CP949 의 '서울'
  assert.equal(decodeText(Buffer.from('﻿서울', 'utf8')), '서울');               // BOM 있는 UTF-8
});
const HEAD = '무인교통단속카메라관리번호,시도명,시군구명,도로노선명,소재지도로명주소,위도,경도,단속구분,제한속도,보호구역구분,설치연도';
const rowsOf = lines => { const t = parseCsv([HEAD, ...lines].join('\n')); const h = t[0]; return mapRecords(t.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])))); };
test('서울 카메라만, 제한속도는 10~120 만, 중복은 하나로', () => {
  const { list, stat } = build(rowsOf([
    '1,서울특별시,강남구,테헤란로,서울 강남구 테헤란로 1,37.5000,127.0300,1,50,0,2015',
    '2,서울특별시,강남구,테헤란로,서울 강남구 테헤란로 1,37.5000,127.0300,1,50,0,2015',      // 같은 지점·같은 값 → 중복
    '3,서울특별시,송파구,올림픽로,,37.5100,127.1000,1,0,1,2018',                              // 제한속도 0 → 값 없음(null)
    '4,서울특별시,송파구,올림픽로,,37.5200,127.1100,2,,,',                                    // 빈 값
    '5,서울특별시,서초구,반포대로,,37.5300,127.0100,1,999,,',                                 // 이상한 값 → null
    '6,부산광역시,해운대구,해운대로,,35.1600,129.1600,1,60,,',                                // 서울 아님
    '7,서울특별시,종로구,율곡로,,,,1,50,,',                                                   // 좌표 없음
    '8,서울특별시,종로구,율곡로,,0,0,1,50,,'                                                  // 좌표 0 → 서울 밖
  ]));
  assert.equal(list.length, 4);
  assert.deepEqual(list.map(c => c.limit), [50, null, null, null]);
  assert.equal(list[0].road, '테헤란로'); assert.equal(list[0].kind, '1'); assert.equal(list[1].zone, '1');
  assert.equal(stat.dup, 1); assert.equal(stat.notSeoul, 2); assert.equal(stat.badCoord, 1);
});
test('API 영문 항목 이름(lat · lot · limitSpeed …)도 알아본다', () => {
  const { list } = build(mapRecords([{ ctpvNm: '서울특별시', roadNm: '시험로', roadNmAddr: '서울 시험', lat: '37.55', lot: '126.98', limitSpeed: '30', crcdClas: '4', proAreaDiv: '' }]));
  assert.deepEqual(list.map(c => [c.lat, c.lng, c.limit, c.kind, c.road]), [[37.55, 126.98, 30, '4', '시험로']]);
});
test('명령줄 도구: CSV(CP949) → JSON 파일과 요약', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cams-')), out = path.join(dir, 'out.json');
  const csv = path.join(dir, 'in.csv');
  fs.writeFileSync(csv, '﻿' + [HEAD, '1,서울특별시,강남구,테헤란로,서울 강남구,37.5,127.03,1,60,,2015', '2,서울특별시,강남구,테헤란로,서울 강남구,37.51,127.04,1,,,'].join('\r\n'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build_cameras.mjs'), csv, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(j.length, 2); assert.equal(j[0].limit, 60); assert.equal(j[1].limit, null);
  assert.match(r.stdout, /제한속도별/); assert.match(r.stdout, /코드 뜻은 확인 전/);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build_cameras.mjs'), path.join(dir, 'none.csv'), '--out', out], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);                                                                  // 없는 파일은 오류로 알린다
  fs.rmSync(dir, { recursive: true, force: true });
});
