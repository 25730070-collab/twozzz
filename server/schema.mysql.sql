-- Safe Drive 회원 DB (MySQL 8 / MariaDB 10.5+). 서버가 시작할 때 자동으로 만들기도 하지만, 직접 만들고 싶을 때 쓰세요.
--   mysql -u root -p < schema.mysql.sql
CREATE DATABASE IF NOT EXISTS safedrive DEFAULT CHARACTER SET utf8mb4;
-- 전용 계정(권한 최소): 비밀번호는 직접 바꿔서 쓰세요
-- CREATE USER 'safedrive'@'localhost' IDENTIFIED BY '여기에_비밀번호';
-- GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX ON safedrive.* TO 'safedrive'@'localhost';
USE safedrive;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL,           -- 소문자로 정리해서 저장
  nickname VARCHAR(30) NOT NULL,         -- 보이는 닉네임
  nickname_key VARCHAR(30) NOT NULL,     -- 중복 검사용(소문자)
  created_at BIGINT NOT NULL,            -- 밀리초(epoch)
  last_login_at BIGINT NULL,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_nickname_key (nickname_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_codes (  -- 인증번호 기록: 번호 자체가 아니라 HMAC 해시만 저장
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  purpose VARCHAR(10) NOT NULL,          -- signup | login
  nickname VARCHAR(30) NULL,             -- 가입일 때 인증과 함께 정해 둔 닉네임
  code_hash CHAR(64) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT NULL,
  KEY idx_codes_email (email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (     -- 로그인 유지: 토큰 자체가 아니라 SHA-256 해시만 저장
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  UNIQUE KEY uq_sessions_token (token_hash),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
