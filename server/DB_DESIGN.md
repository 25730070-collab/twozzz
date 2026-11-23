# Safe Drive DB 설계 (v0.6, 12주차)

DB 는 MySQL 8(실서비스)과 SQLite(설치 없이 시험)를 같은 모양으로 지원해요. 표 정의의 원본은 `server/db.js`, MySQL 직접 설치용은 `schema.mysql.sql` 이에요.

## 1. 표 한눈에 보기 (ERD)

```
users ─┬─< sessions          (로그인 유지: 토큰의 해시만 저장)
       ├─< reports           (내 제보)
       └─< recent_searches   (내 최근 검색)

email_codes                  (이메일 인증번호: 회원과 이메일로만 이어짐, FK 없음)
segments                     (공공데이터 위험 구간 · 배치 작업이 채움)
batch_runs                   (배치 실행 기록)
```
`─<` 는 "1 대 다". users 의 행을 지우면 sessions·reports·recent_searches 가 `ON DELETE CASCADE` 로 함께 지워져요(회원 탈퇴 = 계정과 그 사람 데이터가 한 번에 사라짐).

## 2. 표별 설명

| 표 | 하는 일 | 핵심 열 |
|---|---|---|
| users | 회원 | `id`(내부 순번) · `public_id`(밖에 쓰는 무작위 ID) · `email`(UNIQUE, 소문자) · `nickname_key`(UNIQUE, 중복 검사) · `password_hash` |
| email_codes | 가입·비밀번호 찾기 인증번호 | `purpose`(signup/reset) · `code_hash`(번호 자체는 저장 안 함) · `attempts` · `expires_at` |
| sessions | 로그인 | `token_hash`(UNIQUE) · `user_id` · `expires_at` |
| reports | 내 제보 | `public_id` · `user_id` · `road_name` · `address` · `risk_level` · `accident_count`(NULL = 정보 없음) |
| recent_searches | 최근 검색 | `public_id` · `user_id` · `kind`(query/route) · `q` · `origin` · `destination` |
| segments | 공공데이터 구간(J·A) | `segment_id`(UNIQUE) · `source` · `risk_level` · `lat/lng` · `payload`(원본 JSON) |
| batch_runs | 배치 기록 | `ran_at` · `added` · `removed` · `changed` · `applied` |

## 3. 키(ID) 규칙
- **내부 id**: `AUTO_INCREMENT` 순번. 표끼리 연결(FK)할 때만 쓰고 **API 로 내보내지 않아요** (순번이 보이면 회원 수를 짐작하거나 남의 번호를 찍어 볼 수 있어서).
- **public_id**: 밖에 보이는 ID. 무작위 12자(헷갈리는 0/o/1/l/i 제외) + 접두사 `u_`(회원) `user-`(제보) `rc_`(최근 검색). 겹치면 다시 뽑아요(UNIQUE 로 보장).
- **브라우저(localStorage) 쪽 ID**: `<접두사>_<시간36><순번36><무작위3>` — `fv_` 즐겨찾기 · `rc_` 최근 검색 · `im_` 가져온 항목. 저장 키는 모두 `sd_` 로 시작하고 `sd_schema` 가 저장 형식 번호(현재 2)예요.

## 4. 어디에 저장되나 (localStorage vs DB)
| 데이터 | 로그인 안 함 | 로그인함 |
|---|---|---|
| 즐겨찾기 | 이 기기(localStorage) | **이 기기만** (개인 설정이라 서버로 안 보냄. 옮기려면 데이터 관리의 복사·붙여넣기/JSON) |
| 제보 | 이 기기 | **서버 DB 가 원본**, 이 기기에는 복사본(`remote:true`) |
| 최근 검색 | 이 기기 | **서버 DB 가 원본**, 이 기기에는 복사본 |
| 닉네임·이메일·비밀번호 | — | 서버 DB (`users`) |
- 로그인하면: 이 기기에서 쌓은 제보·최근 검색(`remote` 표시 없음) → 서버로 올림(`/api/me/import`) → 서버 것을 받아 복사본 갱신.
- 로그아웃하면: 이 기기의 서버 복사본(제보·최근 검색)을 지움. 즐겨찾기는 남음.

## 5. 보안 설계 메모
- 비밀번호: scrypt(N=16384, r=8, p=1, 사람마다 다른 salt) → `scrypt$N$r$p$salt$hash` 로 저장. 원문은 저장·로그 모두 안 함.
- 인증번호·로그인 토큰: 번호/토큰 자체가 아니라 해시만 저장.
- 특정인 유추 방지: 가입/비밀번호 찾기 응답이 이메일 가입 여부와 관계없이 같음, 로그인 실패 문구 하나, 틀린 계정도 해시 계산 시간 맞춤, 남의 제보·검색은 404, public_id 는 무작위, 횟수 제한(이메일·IP별).
- 탈퇴는 비밀번호 확인 후 `DELETE FROM users` → CASCADE.

## 6. 업그레이드 (v0.5 → v0.6)
서버가 켜질 때 `upgrade()` 가 v0.5 DB 에 `ALTER TABLE users ADD COLUMN ...` 으로 열을 더하고 `public_id` 를 채워요. MySQL 계정에 **ALTER 권한**이 필요해요:
`GRANT ALTER ON safedrive.* TO 'safedrive'@'localhost'; FLUSH PRIVILEGES;`
v0.5 회원은 비밀번호가 없어서 "비밀번호 찾기"(이메일 인증)로 정해야 로그인돼요.

## 7. 배치 작업 (`tools/batch_sync.mjs`)
공공데이터 API 로 새로 받은 구간 JSON 과 DB(`segments`)를 비교해 늘고·줄고·바뀐 구간을 보고서(`data/batch_report.md`)로 쓰고, `--apply` 를 주면 DB 에 반영(`batch_runs` 에 기록)해요. 화면은 아직 `data/*.json` 을 직접 읽어요(구간을 DB 에서 내려주는 API 는 다음 과제).
