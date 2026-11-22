/* index.js — 서버 시작.  실행:  cd server && npm install && node index.js
   .env 파일(server/.env)에서 설정을 읽는다. 예시는 .env.example. .env 는 절대 git 에 올리지 않는다. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/* 아주 작은 .env 읽기 (이미 설정된 환경변수는 덮어쓰지 않는다) */
try {
  for (const line of fs.readFileSync(path.join(here, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]; if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');     // 따옴표 없는 값 뒤의 '# 설명'은 버린다
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* .env 가 없으면 환경변수/기본값만 쓴다 */ }

const env = process.env;
const prod = env.NODE_ENV === 'production';
let secret = env.APP_SECRET;
if (!secret || secret.length < 16) {
  if (prod) { console.error('APP_SECRET(16자 이상)을 .env 에 넣어 주세요. 예: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'); process.exit(1); }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('! APP_SECRET 이 없어 임시 값으로 시작해요 (서버를 껐다 켜면 진행 중이던 인증은 무효가 돼요)');
}
const cfg = { ...env, APP_SECRET: secret, STATIC_DIR: env.STATIC_DIR || path.join(here, '..') };
if (env.SERVE_STATIC === '0') delete cfg.STATIC_DIR;
if (!cfg.CORS_ORIGINS) cfg.CORS_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

try {
  const db = await openDb({ ...cfg, SQLITE_PATH: env.SQLITE_PATH || path.join(here, 'dev.sqlite') });
  const mailer = await createMailer(cfg);
  const app = createApp({ db, mailer, cfg });
  const port = Number(env.PORT || 3000), host = env.HOST || '127.0.0.1';
  http.createServer((req, res) => { app.handle(req, res).catch(e => { console.error(e); if (!res.headersSent) res.writeHead(500); res.end(); }); })
    .listen(port, host, () => {
      console.log(`\nSafe Drive 서버  http://${host}:${port}`);
      console.log(`  DB   : ${db.kind === 'mysql' ? `MySQL (${cfg.MYSQL_HOST || '127.0.0.1'}/${cfg.MYSQL_DATABASE})` : 'SQLite 파일 (개발용 · 실제 서비스는 DB=mysql)'}`);
      console.log(`  메일 : ${mailer.kind === 'smtp' ? `SMTP 로 실제 발송 (${cfg.SMTP_HOST})` : '발송 안 함 — 인증번호가 이 터미널에만 찍혀요 (.env 에 SMTP_HOST 를 넣으면 실제 메일)'}`);
      console.log(`  화면 : ${cfg.STATIC_DIR ? `http://${host}:${port}/  (같은 주소에서 앱도 열려요)` : '제공 안 함 (API 만)'}\n`);
    });
} catch (e) {
  console.error('\n서버를 시작하지 못했어요:', e.message, '\n');
  process.exit(1);
}
