# Safe Drive 데이터 명세

## 위험 구간 레코드 (segments_static.json / segments_api.json 공통)
| 필드 | 자료형 | 설명 | 구분 |
|---|---|---|---|
| segmentId | string | `seg-연도-코드`(J) / `api-연도-코드`(A) / `user-시각`(U) | 관리용 |
| roadName | string | 구간명 (API spot_nm에서 지자체명 제외) | 실제 |
| accidentCount | number | 사고 건수 | 실제 |
| riskLevel | number 1~4 | 사고 건수 사분위수 기준 상대 등급 (≤30→1, ≤36→2, ≤45→3, 그 이상→4) | 가공 |
| address | string | 구간명(지자체 포함) | 실제 |
| lat, lng | number | 좌표 | 실제 |
| year | number | 기준 연도 | 실제 |
| source | string | "static" (J) / "api" (A) / "user" (U) | 관리용 |
| meta | object | 아래 참고 | 관리용 |
| casualtyCount 등 | number | 응답에 있을 때만: casualtyCount·deathCount·seriousCount·minorCount·injuryReportCount | 실제 |

- 전체 = J 100건 + A 397건 (2026-11-23 갱신: 2019~2025년, 497건) (J와 A는 겹치지 않음, 같은 장소는 주소+좌표 기준 최근 연도 1건)
- 더미 데이터 없음. 최근 검색·즐겨찾기·제보는 사용자 상태(LocalStorage)이며 JSON 파일이 아님.

## meta (관리용 필드, 화면에 직접 보여주지 않음)
source: "json"|"api"|"user", real: 실제 값 필드명 배열, derived: 계산·가공 필드명 배열, dummy: 더미 필드명 배열(사용 금지, 항상 빈 배열), api: 실행 중 API로 채우는 필드, user: 사용자 입력 필드, note: 설명

## LocalStorage
sd_favorites(즐겨찾기 구간), sd_recent(검색어), sd_reports(내 제보), sd_user(가입 정보)
