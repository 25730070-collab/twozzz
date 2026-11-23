-- Safe Drive DB (MySQL 8 / MariaDB 10.5+) · v0.6. server/db.js 의 MYSQL_SCHEMA 와 같은 표예요(서버가 처음 켜질 때 자동으로 만들기도 해요).
--   mysql -u root -p < schema.mysql.sql
CREATE DATABASE IF NOT EXISTS safedrive DEFAULT CHARACTER SET utf8mb4;
-- 전용 계정(권한 최소): 비밀번호는 직접 바꿔서 쓰세요
-- CREATE USER 'safedrive'@'localhost' IDENTIFIED BY '여기에_비밀번호';
-- GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON safedrive.* TO 'safedrive'@'localhost'; FLUSH PRIVILEGES;
--   (ALTER: v0.5 DB 를 v0.6 으로 올릴 때 users 에 열을 더하려면 필요해요)
USE safedrive;

CREATE TABLE IF NOT EXISTS users (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_codes (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  UNIQUE KEY uq_sessions_token (token_hash),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reports (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recent_searches (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS segments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS batch_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ran_at BIGINT NOT NULL,
  source VARCHAR(20) NOT NULL,
  total_new INT NOT NULL,
  added INT NOT NULL,
  removed INT NOT NULL,
  changed INT NOT NULL,
  applied TINYINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- users.public_id 의 UNIQUE 인덱스는 서버가 시작할 때 만들어요. 직접 만들려면:
-- ALTER TABLE users ADD UNIQUE KEY uq_users_public (public_id);
