# Safe Drive 데이터 명세 (내비게이션 버전)

## 위험 구간 레코드 (segments_static.json / segments_api.json 공통)
segmentId, roadName, roadType(대로/이면도로/골목길), accidentCount, riskLevel(1~4), address, lat, lng, source("static"|"api")

- riskLevel: 사고 1~2건→1, 3~5→2, 6~9→3, 10건 이상→4
- segments_static.json: 기본 데이터 (샘플 312건, source:"static")
- segments_api.json: 공공데이터포털 API로 가져온 데이터 (source:"api"). `SERVICE_KEY=... node tools/fetch_api.mjs` 로 생성. 현재는 빈 배열.

## 경로 객체 (js/route-api.js)
{ type: fast|safe, minutes, km, path:[[lat,lng]..], guides:[{text,at,...}], hazards:[{seg, at}], score, high }
- 안전 경로: 가장 빠른 경로 시간의 1.35배 이내 중 위험 점수(가중치 1/2/4/8)가 가장 낮은 경로

## LocalStorage
sd_favorites, sd_recent, sd_drills, sd_user

## 설정 (js/config.js, 키는 js/config.local.js)
KAKAO_REST_KEY 가 비어 있으면 데모 모드, 값이 있으면 카카오 길찾기 실서비스 모드.
config.local.js 는 .gitignore 처리되어 있어 GitHub에 올라가지 않습니다.
