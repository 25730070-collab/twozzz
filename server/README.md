# Safe Drive 회원 서버 (Node + MySQL + 이메일 인증번호)

회원가입·로그인을 **진짜 이메일 인증번호**로 하고, 회원 정보를 **MySQL**에 저장하는 작은 서버예요. 비밀번호는 없어요(인증번호 방식).
화면(`index.html` 등)은 그대로고, 가입 화면(`pages/signup.html`)이 이 서버가 있으면 서버와 대화하고, 없으면 지금까지처럼 **실습 모드**(이 기기에만 저장)로 동작해요.

```
브라우저(앱) ──/api──▶ server/index.js ──▶ MySQL (users · email_codes · sessions)
                              └──────────▶ SMTP(Gmail 등) ──▶ 사용자 이메일
```

## 먼저 알아둘 것
- **GitHub Pages는 화면만 올리는 곳**이라 DB·메일을 못 해요. 이 서버는 따로 실행해야 해요 (내 노트북에서 켜거나, Node를 올릴 수 있는 호스팅에 올려요).
- 서버가 없을 때는 가입 화면이 **실습 모드**로 바뀌고 "실습 모드예요" 안내가 떠요. 그래서 Pages 발표 화면이 깨지지 않아요.
- 확인한 것 / 못 한 것
  - 확인함: 서버 로직 17개 + 화면↔서버↔DB 통합 시험(`npm run test:server`, `npm test`) — 메모리 SQLite와 가짜 발송기로 확인
  - **못 함: 진짜 MySQL 연결, 진짜 메일 발송.** 만든 환경에서 MySQL과 외부 메일에 닿을 수 없었어요. SQL은 SQLite 시험을 통과한 단순한 문장이지만, **처음 켤 때 오류가 날 수 있어요** (아래 '문제 해결' 참고).

## 1) 가장 빠른 시도 (설치 거의 없이)
Node 22.5 이상이면 MySQL 없이 개발용 SQLite 파일로 바로 돼요. 메일은 보내지 않고 **서버 터미널에 인증번호를 찍어요**.
```
cd server
npm install
node index.js
```
브라우저에서 `http://127.0.0.1:3000` → 마이 → 가입. 인증번호는 서버를 켠 터미널에 `제목: [Safe Drive] 회원가입 인증번호 123456` 으로 나와요.
(발표 시연용으로 화면에도 번호를 보이고 싶으면 `.env`에 `DEV_SHOW_CODE=1` — 메일 설정이 없을 때만 동작해요.)

## 2) MySQL 로 저장하기
1. MySQL 8 설치 (Windows는 *MySQL Installer*). 설치할 때 정한 root 비밀번호를 기억해 두세요.
2. 데이터베이스와 전용 계정 만들기 (MySQL Workbench 또는 `mysql -u root -p` 에서):
   ```sql
   CREATE DATABASE safedrive DEFAULT CHARACTER SET utf8mb4;
   CREATE USER 'safedrive'@'localhost' IDENTIFIED BY '여기에_비밀번호';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON safedrive.* TO 'safedrive'@'localhost';
   ```
   표(users·email_codes·sessions)는 서버가 처음 켜질 때 자동으로 만들어요. 직접 만들고 싶으면 `schema.mysql.sql`.
3. 설정 파일 만들기:
   ```
   copy .env.example .env
   ```
   `.env`를 열어 `DB=mysql`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `APP_SECRET` 을 채워요.
   `APP_SECRET`(무작위 긴 값) 만들기: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. `node index.js` → 터미널에 `DB : MySQL (127.0.0.1/safedrive)` 가 나오면 연결된 거예요.
5. 가입한 뒤 Workbench에서 `SELECT * FROM users;` 로 저장된 걸 볼 수 있어요. (`email_codes.code_hash`, `sessions.token_hash` 는 해시라서 번호·토큰 원문은 없어요)

## 3) 진짜 이메일로 인증번호 보내기
`.env`에 SMTP 정보를 넣으면 메일을 실제로 보내요. 예 (Gmail):
1. 구글 계정 → 보안 → **2단계 인증** 켜기 → **앱 비밀번호** 만들기 (평소 비밀번호가 아니라 16자리 전용 비밀번호예요. 화면 구성은 바뀔 수 있어요)
2. `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=내계정@gmail.com
   SMTP_PASSWORD=앱비밀번호16자리
   MAIL_FROM="Safe Drive <내계정@gmail.com>"
   ```
3. 서버를 다시 켜면 `메일 : SMTP 로 실제 발송` 이 나와요. 가입 화면에서 받은편지함(스팸함도)을 확인하세요.
- 네이버·다음, 또는 Resend·SendGrid·Mailgun 같은 메일 서비스도 SMTP 정보만 알면 같은 방식이에요. 개인 Gmail은 하루 발송 한도가 작으니 시연·수업용으로만 쓰세요.
- 발표 직후 **앱 비밀번호는 삭제**하세요. `.env`는 절대 GitHub에 올리지 마세요 (`.gitignore`에 들어 있어요).

## 4) 화면과 연결
- **같은 주소(가장 쉬움)**: 서버가 화면도 같이 내보내요. `http://127.0.0.1:3000` 으로 열면 앱이 자동으로 서버를 찾아요. (`SERVE_STATIC=0` 이면 API만)
- **GitHub Pages 화면 + 따로 올린 서버**: `js/config.js` 의 `API_URL` 에 서버 주소(`https://…`)를 넣고, 서버 `.env` 의 `CORS_ORIGINS` 에 Pages 주소(`https://25730070-collab.github.io`)를 넣어요. 서버가 https 여야 해요.
- 폰에서 `http://192.168.…` 로 열면 **위치(GPS)가 막혀요** (브라우저가 https 에서만 위치를 허용해요). 폰 시연은 https 로 올린 주소에서 하세요.

## 5) 인터넷에 올릴 때
- Node를 실행할 수 있는 호스팅 + 바깥에서 접속 가능한 MySQL이 필요해요. 무료 범위·정책은 자주 바뀌니 직접 확인하세요.
- 환경변수로 `NODE_ENV=production`, `HOST=0.0.0.0`, `APP_SECRET`, `MYSQL_*`(클라우드는 보통 `MYSQL_SSL=1`), `SMTP_*`, `CORS_ORIGINS`, 앞에 프록시가 있으면 `TRUST_PROXY=1` 을 넣어요. 시작 명령은 `node index.js`.
- 이 프로젝트의 한도: 요청 횟수 제한이 서버 메모리에 있어서 **서버를 여러 대로 늘리면** 제한이 따로 계산돼요 (Redis/DB로 옮겨야 해요).

## 지키는 것 / 한계
| 항목 | 내용 |
|---|---|
| 인증번호 | 6자리, 암호학적 난수. DB에는 해시(HMAC)만. 3분 유효 · 5번까지 · 한 번만 사용 · 응답에 싣지 않음 |
| 남용 방지 | 같은 이메일 60초 간격 · 시간당 5번, 같은 IP 시간당 20번 |
| 로그인 유지 | 무작위 토큰 30일. 서버에는 SHA-256 해시만. 로그아웃·탈퇴 때 삭제 |
| 개인정보 | 닉네임·이메일만. **탈퇴하면 계정·세션·인증 기록 삭제** |
| SQL | 모든 값은 `?` 자리표시자로 전달 (문자열을 이어 붙이지 않음) |
| 한계 | 토큰은 브라우저 localStorage 에 있어 XSS에 취약한 편(쿠키 방식이 더 안전하나 서로 다른 주소 사이에선 설정이 복잡). 이메일 존재 여부가 오류 문구로 드러남(편의를 택함). 실제 서비스라면 **개인정보처리방침·이용약관**과 법적 검토가 필요해요 |

## API
| 메서드 · 주소 | 설명 |
|---|---|
| `GET /api/health` | 서버 확인 (화면이 서버 유무를 알아볼 때 사용) |
| `POST /api/auth/request-code` `{email, purpose:'signup'｜'login', nickname?}` | 인증번호 메일 발송 |
| `POST /api/auth/verify-code` `{email, purpose, code}` | 가입: `{verifyToken}` · 로그인: `{token, user}` |
| `POST /api/auth/signup` `{verifyToken}` | 가입 완료 → `{token, user}` |
| `GET /api/me` · `POST /api/auth/logout` · `DELETE /api/me` | 내 정보 · 로그아웃 · 탈퇴 (`Authorization: Bearer <token>`) |

## 문제 해결
- `mysql2 패키지가 없어요` → `server` 폴더에서 `npm install`
- `ECONNREFUSED` → MySQL이 꺼져 있거나 `MYSQL_HOST/PORT` 가 달라요
- `Access denied for user` → `MYSQL_USER/PASSWORD` 확인, 계정에 `safedrive` 권한이 있는지
- `Client does not support authentication protocol` → mysql2 최신 버전인지 확인 (`npm install mysql2@latest`)
- Gmail `Invalid login` / `535` → 평소 비밀번호가 아니라 **앱 비밀번호**를 썼는지, 2단계 인증이 켜져 있는지
- 메일이 안 와요 → 스팸함, `MAIL_FROM`, 서버 터미널의 `[메일 발송 실패]` 줄
- 가입 화면에 "실습 모드"가 떠요 → 서버가 안 켜져 있거나 `API_URL`/CORS 가 맞지 않아요 (브라우저 개발자도구 → Network 의 `/api/health` 확인)
