# Safe Drive

초보 운전자를 위한 **위험 구간 확인 서비스** (한국도로교통공단 교통사고 다발지역 공공데이터 기반).
교통사고 다발지역 공공데이터를 JSON으로 연결해 위험 구간을 보여 주는 정적 웹(HTML/CSS/JS)입니다.

## 실행
- GitHub Pages 배포 주소, 또는 `python3 -m http.server 8000` → http://localhost:8000
  (HTML을 더블클릭해 열면 file:// 이라 fetch가 막혀 "불러오기 실패" 안내가 나옵니다)

## 폴더
```
index.html            홈 (나머지 화면은 pages/)
pages/                list · detail · report · my · signup
css/  js/             base·layout·components·pages / 화면별 + common·data·storage
data/segments_static.json   J · 저장 JSON 100건 (공공데이터)
data/segments_api.json      A · J에 없는 구간 (공공데이터 API로 수집, 247건)
tools/                fetch_api.mjs (API 수집) · check_data.mjs (검수)
```

## 데이터 원칙
**사고 다발지역 공공데이터 외의 값은 AI가 만들지 않습니다.** 연습 코스·대처법·팁·도로유형 추정·소요 시간·거리 등 임의로 만든 값과 문구는 모두 제거했습니다.

## 데이터 출처·구분표

| 데이터 | 출처 | 건수 | 연결 방식 | 값의 성격 |
|---|---|---|---|---|
| J · segments_static.json | 한국도로교통공단 지자체별 교통사고 다발지역 (공공데이터포털 data.go.kr) | 100 | API로 받아 저장한 JSON (fetch) | 실제: roadName·accidentCount·address·lat·lng·year / 가공: riskLevel |
| A · segments_api.json | 같은 API — J에 없는 구간만 | 247 | `tools/fetch_api.mjs`로 API 호출 | J와 동일 (J와 겹치는 구간 없음) |
| U · 사용자 제보 | 사용자가 제보 화면에서 직접 입력 | 입력한 만큼 | LocalStorage (`sd_reports`) | 사용자 입력(검증 전) |

- riskLevel: 수집한 데이터의 사고 건수 사분위수 기준 **상대 등급** (≤30건 1등급, ≤36건 2등급, ≤45건 3등급, 46건 이상 4등급). 화면에 "가공" 태그로 표시합니다.
- 구별 사고 건수는 위 데이터를 합산한 값입니다.
- 응답에 사상자·사망자 등 피해 현황 필드가 있으면 `tools/fetch_api.mjs`가 함께 저장하고, 있을 때만 상세에 표시합니다.

## 출처 플래그 (meta)
각 항목에 `source`(J: static / A: api / U: user)와 `meta`가 있습니다.
```json
{ "segmentId": "seg-2023-11650001", "roadName": "...", "accidentCount": 84, "riskLevel": 4, "year": 2023, "source": "static",
  "meta": { "source": "json", "real": ["roadName","accidentCount","address","lat","lng","year"], "derived": ["riskLevel"], "dummy": [], "api": [] } }
```
화면: 카드에 **J / A / U** 태그, 상세에 필드별 **실제 / 가공 / 제보 / 미입력** 태그와 "실제 N · 가공 M" 요약.

## 예외 화면
- 검색·필터 결과 0건 → 빈 상태 화면(이유·해결 방법·버튼), 불러오기 실패와 구분
- 값이 null → '정보 없음' + [미입력] 태그
- 좌표 없음 → 지도 자리에 "위치 정보가 없어 지도를 표시할 수 없어요"
- F12 Console `[데이터 점검]`: 건수, 출처별 건수, 중복·meta 누락·더미 필드, null 건수

## 데이터 수정 흐름
1. `SERVICE_KEY=키 node tools/fetch_api.mjs` → `segments_static.json`(100건) + `segments_api.json`(나머지). 2019~2023년을 받아 같은 장소는 최근 해 1건만 남깁니다.
2. `node tools/check_data.mjs` 로 검수
3. 커밋·푸시 → 배포 확인 → 강력 새로고침 → Console `[데이터 점검]` 확인

## 경로 비교 (빠른 경로 · 안전 경로)
- 경로·소요 시간·거리는 **카카오 길찾기 API 값**만 사용합니다. 키가 없으면 경로를 만들지 않고 "연결 전" 안내 화면을 보여 줍니다(임의 경로·시간 없음).
- **빠른 경로** = API 후보 경로 중 소요 시간이 가장 짧은 경로
- **안전 경로** = 빠른 경로의 1.35배 시간 안에서, 경로 120m 이내 사고 다발지점의 **사고 건수 합**이 가장 적은 경로 (사고 건수는 공공데이터 실제 값)
- 더 나은 대안 경로가 없으면 "더 안전한 대안 경로가 없어요"라고 안내합니다.
- 키 설정: `js/config.local.example.js` 를 `js/config.local.js` 로 복사 후 키 입력 (.gitignore 대상, 저장소에 올리지 않음)
