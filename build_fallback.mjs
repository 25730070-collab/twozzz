// data/segments_static.json + segments_api.json → data/segments.fallback.js
// 파일을 더블클릭(file://)으로 열면 브라우저가 fetch를 막는다. 그때만 이 복사본을 쓴다 (내용은 두 JSON과 같다).
// 데이터를 다시 수집한 뒤 실행:  node tools/build_fallback.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const s = JSON.parse(readFileSync('data/segments_static.json', 'utf8')), a = JSON.parse(readFileSync('data/segments_api.json', 'utf8'));
writeFileSync('data/segments.fallback.js', '/* 자동 생성 — 수정하지 마세요. 원본: segments_static.json, segments_api.json */\nwindow.SD_FALLBACK = ' + JSON.stringify({ static: s, api: a }) + ';\n');
console.log(`data/segments.fallback.js 생성: J ${s.length} + A ${a.length}`);
