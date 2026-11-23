/* db.js — 데이터베이스 연결 두 가지 + 표 설계(v0.6)
   · mysql  : 실제 서비스용 (mysql2). DB=mysql 로 켠다.
   · sqlite : 설치 없이 바로 써 보는 개발용 (Node 내장 node:sqlite, Node 22.5 이상). 기본값.
   두 쪽이 똑같은 SQL 을 쓰도록 시간은 모두 '밀리초 정수'로 넣고, 날짜 함수는 쓰지 않는다. 표는 아래 두 묶음이 같은 모양이다.

   표 설계 (설계 그림과 설명은 server/DB_DESIGN.md)
     users            회원            ─┬─< sessions        로그인 유지(토큰 해시)
                                       ├─< reports         내 제보(위험 구간)
                                       └─< recent_searches 최근 검색
     email_codes      이메일 인증번호(가입·비밀번호 재설정). 회원과 이메일로만 이어진다(가입 전에도 쓰므로 FK 없음)
     segments         공공데이터 위험 구간(J·A) (배치 작업 tools/batch_sync.mjs 가 채운다)
     batch_runs       배치 실행 기록

   키 규칙: 안쪽 id(id)는 순번(AUTO_INCREMENT)이고 밖으로 내보내지 않는다. 밖에는 public_id(무작위 문자열)만 쓴다. */

/* ---------- 새로 만들 때 ---------- */
const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     public_id TEXT,
     email TEXT NOT NULL UNIQUE,
     nickname TEXT NOT NULL,
     nickname_key TEXT NOT NULL UNIQUE,
     password_hash TEXT,
     created_at INTEGER NOT NULL,
     last_login_at INTEGER,
     pw_changed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS email_codes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL,
     purpose TEXT NOT NULL,
     nickname TEXT,
     code_hash TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_codes_email ON email_codes (email, created_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     public_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     road_name TEXT NOT NULL,
     address TEXT NOT NULL,
     risk_level INTEGER NOT NULL,
     accident_count INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS recent_searches (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     public_id TEXT NOT NULL UNIQUE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     q TEXT,
     origin TEXT,
     destination TEXT,
     searched_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_searches (user_id, searched_at)`,
  `CREATE TABLE IF NOT EXISTS segments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     segment_id TEXT NOT NULL UNIQUE,
     source TEXT NOT NULL,
     road_name TEXT NOT NULL,
     address TEXT NOT NULL,
     accident_count INTEGER,
     risk_level INTEGER NOT NULL,
     lat REAL,
     lng REAL,
     year INTEGER,
     payload TEXT NOT NULL,
     first_seen_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS batch_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ran_at INTEGER NOT NULL,
     source TEXT NOT NULL,
     total_new INTEGER NOT NULL,
     added INTEGER NOT NULL,
     removed INTEGER NOT NULL,
     changed INTEGER NOT NULL,
     applied INTEGER NOT NULL)`
];

const MYSQL_TAIL = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
export const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     public_id VARCHAR(24) NULL,
     email VARCHAR(254) NOT NULL,
     nickname VARCHAR(30) NOT NULL,
     nickname_key VARCHAR(30) NOT NULL,
     password_hash VARCHAR(255) NULL,
     created_at BIGINT NOT NULL,
     last_login_at BIGINT NULL,
     pw_changed_at BIGINT NULL,
     UNIQUE KEY uq_users_email (email),
     UNIQUE KEY uq_users_nickname_key (nickname_key)
   ) ${MYSQL_TAIL}`,
  `CREATE TABLE IF NOT EXISTS email_codes (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     email VARCHAR(254) NOT NULL,
     purpose VARCHAR(10) NOT NULL,
     nickname VARCHAR(30) NULL,
     code_hash CHAR(64) NOT NULL,
     attempts INT NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     used_at BIGINT NULL,
     KEY idx_codes_email (email, created_at)
   ) ${MYSQL_TAIL}`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     user_id BIGINT UNSIGNED NOT NULL,
     token_hash CHAR(64) NOT NULL,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     UNIQUE KEY uq_sessions_token (token_hash),
     CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) ${MYSQL_TAIL}`,
  `CREATE TABLE IF NOT EXISTS reports (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     public_id VARCHAR(24) NOT NULL,
     user_id BIGINT UNSIGNED NOT NULL,
     road_name VARCHAR(60) NOT NULL,
     address VARCHAR(160) NOT NULL,
     risk_level TINYINT NOT NULL,
     accident_count INT NULL,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NULL,
     UNIQUE KEY uq_reports_public (public_id),
     KEY idx_reports_user (user_id, created_at),
     CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) ${MYSQL_TAIL}`,
  `CREATE TABLE IF NOT EXISTS recent_searches (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     public_id VARCHAR(24) NOT NULL,
     user_id BIGINT UNSIGNED NOT NULL,
     kind VARCHAR(8) NOT NULL,
     q VARCHAR(100) NULL,
     origin VARCHAR(100) NULL,
     destination VARCHAR(100) NULL,
     searched_at BIGINT NOT NULL,
     UNIQUE KEY uq_recent_public (public_id),
     KEY idx_recent_user (user_id, searched_at),
     CONSTRAINT fk_recent_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
   ) ${MYSQL_TAIL}`,
  `CREATE TABLE IF NOT EXISTS segments (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     segment_id VARCHAR(64) NOT NULL,
     source VARCHAR(8) NOT NULL,
     road_name VARCHAR(120) NOT NULL,
     address VARCHAR(200) NOT NULL,
     accident_count INT NULL,
     risk_level TINYINT NOT NULL,
     lat DOUBLE NULL,
     lng DOUBLE NULL,
     year SMALLINT NULL,
     payload TEXT NOT NULL,
     first_seen_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL,
     UNIQUE KEY uq_segments_sid (segment_id)
   ) ${MYSQL_TAIL}`,
  `CREATE TABLE IF NOT EXISTS batch_runs (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     ran_at BIGINT NOT NULL,
     source VARCHAR(20) NOT NULL,
     total_new INT NOT NULL,
     added INT NOT NULL,
     removed INT NOT NULL,
     changed INT NOT NULL,
     applied TINYINT NOT NULL
   ) ${MYSQL_TAIL}`
];

/* ---------- v0.5 에서 올라올 때 (이미 있는 users 표에 열을 더한다) ----------
   v0.5 의 users 에는 public_id · password_hash · pw_changed_at 이 없다. MySQL 계정에 ALTER 권한이 필요하다
   (GRANT ALTER ON safedrive.* TO 'safedrive'@'localhost';). 기존 회원은 비밀번호가 비어 있어 '비밀번호 찾기'로 처음 정한다. */
const ADD_COLUMNS = {
  sqlite: [['public_id', 'ALTER TABLE users ADD COLUMN public_id TEXT'], ['password_hash', 'ALTER TABLE users ADD COLUMN password_hash TEXT'], ['pw_changed_at', 'ALTER TABLE users ADD COLUMN pw_changed_at INTEGER']],
  mysql: [['public_id', 'ALTER TABLE users ADD COLUMN public_id VARCHAR(24) NULL'], ['password_hash', 'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL'], ['pw_changed_at', 'ALTER TABLE users ADD COLUMN pw_changed_at BIGINT NULL']]
};
const PUBLIC_ID_INDEX = {
  sqlite: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_users_public ON users (public_id)',
  mysql: 'ALTER TABLE users ADD UNIQUE KEY uq_users_public (public_id)'
};

async function upgrade(db) {
  let added = false;
  for (const [col, sql] of ADD_COLUMNS[db.kind]) {
    if (!(await db.hasColumn('users', col))) {
      try { await db.exec(sql); added = true; }
      catch (e) { throw new Error(`users 표에 ${col} 열을 더하지 못했어요 (${e.message}). MySQL 이면 계정에 ALTER 권한을 주세요: GRANT ALTER ON safedrive.* TO 'safedrive'@'localhost'; FLUSH PRIVILEGES;`); }
    }
  }
  /* 공개 id 가 없는 회원에게 무작위 id 를 채운다 */
  const { newPublicId } = await import('./auth.js');
  for (const u of await db.all('SELECT id FROM users WHERE public_id IS NULL')) {
    for (let i = 0; i < 5; i++) {
      try { await db.run('UPDATE users SET public_id = ? WHERE id = ?', [newPublicId('u_'), u.id]); break; } catch (e) { if (!isDuplicate(e)) throw e; }
    }
  }
  if (added || !(await db.hasIndex('users', 'uq_users_public'))) { try { await db.exec(PUBLIC_ID_INDEX[db.kind]); } catch (e) { if (!/already exists|Duplicate key name/i.test(String(e.message))) throw e; } }
}

/* 같은 값이 이미 있어서 넣지 못했는지 (두 DB 의 오류 모양이 달라서 한곳에서 판단) */
export const isDuplicate = e => !!e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062 || /UNIQUE constraint failed/i.test(String(e.message)));

async function openSqlite(file) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { throw new Error('이 Node 버전에는 개발용 SQLite 가 없어요(Node 22.5 이상 필요). DB=mysql 로 MySQL 을 쓰거나 Node 를 올려 주세요'); }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  const num = v => (typeof v === 'bigint' ? Number(v) : v);
  const conv = r => (r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])));
  const self = {
    kind: 'sqlite',
    async all(sql, p = []) { return db.prepare(sql).all(...p).map(conv); },
    async get(sql, p = []) { return conv(db.prepare(sql).get(...p)); },
    async run(sql, p = []) { const r = db.prepare(sql).run(...p); return { changes: num(r.changes), insertId: num(r.lastInsertRowid) }; },
    async exec(sql) { db.exec(sql); },
    async hasColumn(t, c) { return db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c); },
    async hasIndex(t, n) { return db.prepare(`PRAGMA index_list(${t})`).all().some(x => x.name === n); },
    async transaction(fn) { db.exec('BEGIN'); try { const r = await fn(self); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    async migrate() { SQLITE_SCHEMA.forEach(s => db.exec(s)); await upgrade(self); },
    async close() { db.close(); }
  };
  return self;
}

async function openMysql(cfg) {
  let mod;
  try { mod = await import('mysql2/promise'); }
  catch { throw new Error('mysql2 패키지가 없어요. server 폴더에서 npm install 을 먼저 실행해 주세요'); }
  const mysql = mod.default || mod;
  for (const k of ['MYSQL_USER', 'MYSQL_DATABASE']) if (!cfg[k]) throw new Error(`.env 에 ${k} 가 없어요`);
  const pool = mysql.createPool({
    host: cfg.MYSQL_HOST || '127.0.0.1', port: Number(cfg.MYSQL_PORT || 3306),
    user: cfg.MYSQL_USER, password: cfg.MYSQL_PASSWORD || '', database: cfg.MYSQL_DATABASE,
    waitForConnections: true, connectionLimit: 5,
    ssl: cfg.MYSQL_SSL === '1' ? { rejectUnauthorized: true } : undefined     // 클라우드 MySQL 은 보통 SSL 필요
  });
  const make = conn => ({
    kind: 'mysql',
    async all(sql, p = []) { const [rows] = await conn.execute(sql, p); return rows; },
    async get(sql, p = []) { const [rows] = await conn.execute(sql, p); return rows[0]; },
    async run(sql, p = []) { const [r] = await conn.execute(sql, p); return { changes: r.affectedRows, insertId: Number(r.insertId) }; },
    async exec(sql) { await conn.query(sql); },
    async hasColumn(t, c) { const [r] = await conn.execute('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]); return Number(r[0].n) > 0; },
    async hasIndex(t, n) { const [r] = await conn.execute('SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [t, n]); return Number(r[0].n) > 0; }
  });
  const self = {
    ...make(pool),
    async transaction(fn) { const c = await pool.getConnection(); try { await c.beginTransaction(); const r = await fn(make(c)); await c.commit(); return r; } catch (e) { await c.rollback(); throw e; } finally { c.release(); } },
    async migrate() { for (const s of MYSQL_SCHEMA) await pool.query(s); await upgrade(self); },
    async close() { await pool.end(); }
  };
  return self;
}

export async function openDb(cfg = {}) {
  const db = cfg.DB === 'mysql' ? await openMysql(cfg) : await openSqlite(cfg.SQLITE_PATH || ':memory:');
  await db.migrate();
  return db;
}
