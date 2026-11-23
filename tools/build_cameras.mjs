/* build_cameras.mjs — 공공데이터 '전국 무인교통단속카메라 표준데이터' 파일에서 서울 단속 카메라(위치·제한속도)를 뽑아 data/speed_cameras.json 으로 만든다.
   사용:  node tools/build_cameras.mjs  받은파일.csv  [다른파일.csv ...]  [--out data/speed_cameras.json]
   - 입력은 data.go.kr 에서 내려받은 CSV(UTF-8 이든 한글 윈도우 인코딩 CP949 든 자동으로 알아본다)나, 같은 항목의 JSON 이다.
   - 열 이름은 한글(위도·경도·제한속도…)이든 API 영문 이름(lat·lot·limitSpeed…)이든 알아본다. 없는 열은 비워 둔다 (지어내지 않는다).
   - 서울 안(시도명이 있으면 서울, 없으면 서울 좌표 범위)에 있고 위·경도가 올바른 줄만 담는다.
   - 단속구분·보호구역구분의 코드 뜻은 확인하지 못해서 받은 값 그대로 담는다 (화면은 제한속도 숫자가 있는 카메라만 속도 표지로 보여 준다).
   - 만든 파일은 이 도구가 보여 주는 요약(제한속도별·단속구분별 개수)을 눈으로 한 번 확인한 뒤 쓰자. 표준데이터는 지자체가 달마다 모아서 비어 있는 곳이 있을 수 있다. */
import fs from 'node:fs';
import path from 'node:path';

/* ---------- 읽기 ---------- */
export function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buf); }                 // CP949 (엑셀이 저장한 한글 CSV)
}

/* 따옴표·쉼표·줄바꿈을 지키는 작은 CSV 읽개 */
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/* ---------- 열 이름 → 항목 ---------- */
const COLS = {
  id: ['무인교통단속카메라관리번호', '관리번호', 'unatEnfoNum'],
  sido: ['시도명', 'ctpvNm'],
  sgg: ['시군구명', 'sggNm'],
  road: ['도로노선명', 'roadNm'],
  place: ['소재지도로명주소', '도로명주소', 'roadNmAddr', '설치장소', 'installPlace', '소재지지번주소', '지번주소', 'lotnoAddr'],
  lat: ['위도', 'lat', 'latitude'],
  lng: ['경도', 'lot', 'lng', 'lon', 'longitude'],
  limit: ['제한속도', 'limitSpeed'],
  kind: ['단속구분', 'crcdClas'],
  zone: ['보호구역구분', 'proAreaDiv'],
  year: ['설치연도', 'instlYr']
};
const norm = s => String(s ?? '').replace(/[\s_\-()]/g, '').toLowerCase();

export function mapRecords(rows) {                                         // rows: [{열이름: 값}]
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]), pick = {};
  for (const [f, names] of Object.entries(COLS)) pick[f] = names.map(n => keys.find(k => norm(k) === norm(n))).filter(Boolean);
  const get = (r, f) => { for (const k of pick[f]) { const v = String(r[k] ?? '').trim(); if (v) return v; } return ''; };
  return rows.map(r => ({
    id: get(r, 'id'), sido: get(r, 'sido'), sgg: get(r, 'sgg'), road: get(r, 'road'), place: get(r, 'place'),
    lat: parseFloat(get(r, 'lat')), lng: parseFloat(get(r, 'lng')), limit: parseFloat(get(r, 'limit')),
    kind: get(r, 'kind'), zone: get(r, 'zone'), year: get(r, 'year')
  }));
}

/* 서울 좌표 범위(넉넉하게). 시도명이 있으면 그것을 먼저 본다 */
const SEOUL = { la0: 37.40, la1: 37.72, lo0: 126.73, lo1: 127.20 };
const inSeoul = c => c.lat >= SEOUL.la0 && c.lat <= SEOUL.la1 && c.lng >= SEOUL.lo0 && c.lng <= SEOUL.lo1 && (!c.sido || /서울/.test(c.sido));

export function build(recs) {
  const stat = { rows: recs.length, badCoord: 0, notSeoul: 0, dup: 0 };
  const seen = new Set(), out = [];
  for (const c of recs) {
    if (!isFinite(c.lat) || !isFinite(c.lng)) { stat.badCoord++; continue; }
    if (!inSeoul(c)) { stat.notSeoul++; continue; }
    const limit = isFinite(c.limit) && c.limit >= 10 && c.limit <= 120 ? Math.round(c.limit) : null;   // 0·빈 값·이상한 값은 '제한속도 정보 없음'
    const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)},${limit},${c.kind}`;
    if (seen.has(key)) { stat.dup++; continue; }
    seen.add(key);
    out.push({
      id: c.id || `cam-${out.length + 1}`, lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), limit,
      kind: c.kind || null, zone: c.zone || null, road: c.road || null, place: c.place || null, sgg: c.sgg || null
    });
  }
  return { list: out, stat };
}

/* ---------- 실행 ---------- */
function readRecords(file) {
  const buf = fs.readFileSync(file);
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(decodeText(buf));
    const items = Array.isArray(j) ? j : j?.response?.body?.items?.item || j?.response?.body?.items || j?.items || j?.data || [];
    return mapRecords(Array.isArray(items) ? items : [items]);
  }
  const t = parseCsv(decodeText(buf));
  if (t.length < 2) return [];
  const head = t[0].map(x => x.trim());
  return mapRecords(t.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build_cameras.mjs')) {
  const args = process.argv.slice(2), oi = args.indexOf('--out');
  const OUT = oi >= 0 ? args.splice(oi, 2)[1] : path.resolve(import.meta.dirname, '../data/speed_cameras.json');
  if (!args.length) { console.error('사용: node tools/build_cameras.mjs 받은파일.csv [다른파일.csv ...] [--out 경로]'); process.exit(1); }
  let recs = [];
  for (const f of args) {
    if (!fs.existsSync(f)) { console.error('파일이 없어요:', f); process.exit(1); }
    const r = readRecords(f); console.log(`읽음 ${f} : ${r.length}줄`); recs = recs.concat(r);
  }
  const { list, stat } = build(recs);
  if (!list.length) { console.error('서울 단속 카메라를 하나도 찾지 못했어요. 열 이름(위도·경도…)과 시도명을 확인해 주세요.', stat); process.exit(2); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(list));
  const count = k => Object.entries(list.reduce((a, c) => (a[c[k] ?? '(없음)'] = (a[c[k] ?? '(없음)'] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]);
  console.log(`\n저장 ${OUT} : 서울 ${list.length}곳 (위·경도 이상 ${stat.badCoord} · 서울 밖 ${stat.notSeoul} · 같은 지점 중복 ${stat.dup})`);
  console.log('제한속도별 :', count('limit').map(([k, n]) => `${k}=${n}`).join('  '));
  console.log('단속구분별(코드 뜻은 확인 전, 받은 값 그대로) :', count('kind').map(([k, n]) => `${k}=${n}`).join('  '));
  console.log('보호구역구분별 :', count('zone').map(([k, n]) => `${k}=${n}`).join('  '));
}
