/* db.js — 데이터베이스 연결 두 가지
   · mysql  : 실제 서비스용 (mysql2). DB=mysql 로 켠다.
   · sqlite : 설치 없이 바로 써 보는 개발용 (Node 내장 node:sqlite, Node 22.5 이상). 기본값.
   두 쪽이 똑같은 SQL 을 쓰도록 시간은 모두 '밀리초 정수'로 넣고, 날짜 함수는 쓰지 않는다. 표는 아래 두 묶음이 같은 모양이다. */

const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     nickname TEXT NOT NULL,
     nickname_key TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     last_login_at INTEGER)`,
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
     user_id INTEGER NOT NULL REFERENCES users(id),
     token_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL)`
];

export const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     email VARCHAR(254) NOT NULL,
     nickname VARCHAR(30) NOT NULL,
     nickname_key VARCHAR(30) NOT NULL,
     created_at BIGINT NOT NULL,
     last_login_at BIGINT NULL,
     UNIQUE KEY uq_users_email (email),
     UNIQUE KEY uq_users_nickname_key (nickname_key)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
     user_id BIGINT UNSIGNED NOT NULL,
     token_hash CHAR(64) NOT NULL,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     UNIQUE KEY uq_sessions_token (token_hash),
     CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

/* 같은 값이 이미 있어서 넣지 못했는지 (두 DB 의 오류 모양이 달라서 한곳에서 판단) */
export const isDuplicate = e => !!e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062 || /UNIQUE constraint failed/i.test(String(e.message)));

async function openSqlite(file) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { throw new Error('이 Node 버전에는 개발용 SQLite 가 없어요(Node 22.5 이상 필요). DB=mysql 로 MySQL 을 쓰거나 Node 를 올려 주세요'); }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  const num = v => (typeof v === 'bigint' ? Number(v) : v);
  return {
    kind: 'sqlite',
    async all(sql, p = []) { return db.prepare(sql).all(...p); },
    async get(sql, p = []) { return db.prepare(sql).get(...p); },
    async run(sql, p = []) { const r = db.prepare(sql).run(...p); return { changes: num(r.changes), insertId: num(r.lastInsertRowid) }; },
    async migrate() { SQLITE_SCHEMA.forEach(s => db.exec(s)); },
    async close() { db.close(); }
  };
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
  return {
    kind: 'mysql',
    async all(sql, p = []) { const [rows] = await pool.execute(sql, p); return rows; },
    async get(sql, p = []) { const [rows] = await pool.execute(sql, p); return rows[0]; },
    async run(sql, p = []) { const [r] = await pool.execute(sql, p); return { changes: r.affectedRows, insertId: Number(r.insertId) }; },
    async migrate() { for (const s of MYSQL_SCHEMA) await pool.query(s); },
    async close() { await pool.end(); }
  };
}

export async function openDb(cfg = {}) {
  const db = cfg.DB === 'mysql' ? await openMysql(cfg) : await openSqlite(cfg.SQLITE_PATH || ':memory:');
  await db.migrate();
  return db;
}
