-- =====================================================================
-- Jay Mahalaxmi • App Schema
-- Requires: MySQL 8.0+
-- Charset/collation: utf8mb4 / utf8mb4_unicode_ci
-- =====================================================================

CREATE DATABASE IF NOT EXISTS matchindustry_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE matchindustry_db;

-- ---------------------------------------------------------------------
-- Admin users (email + password hash, lockout fields)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email           VARCHAR(255) NOT NULL UNIQUE,
  pass_hash       VARCHAR(255) NOT NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  failed_attempts INT          NOT NULL DEFAULT 0,
  lock_until      DATETIME     NULL,
  otp_secret      VARCHAR(64)  NULL,
  otp_enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  last_login_at   DATETIME     NULL,
  last_login_ip   VARCHAR(64)  NULL,
  last_login_ua   VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_active (is_active),
  INDEX idx_admin_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Audit logs (optional; useful for admin actions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT      PRIMARY KEY AUTO_INCREMENT,
  actor_type  ENUM('admin','system','anon') NOT NULL DEFAULT 'anon',
  actor_id    BIGINT     NULL,
  action      VARCHAR(64) NOT NULL,
  resource    VARCHAR(64) NULL,
  meta        JSON        NULL,
  ip          VARCHAR(64) NULL,
  ua          VARCHAR(255) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_actor (actor_type, actor_id, created_at),
  INDEX idx_audit_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(120)  NOT NULL,
  slug         VARCHAR(140)  NOT NULL UNIQUE,
  category     VARCHAR(60)   NOT NULL,
  short_desc   VARCHAR(255)  NOT NULL,
  description  TEXT          NOT NULL,
  specs        JSON          NULL,
  price        DECIMAL(10,2) NULL,
  unit         VARCHAR(20)   NULL,
  image        VARCHAR(255)  NULL,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_active   (active),
  INDEX idx_products_category (category),
  INDEX idx_products_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Testimonials (admin moderation uses 'approved')
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS testimonials (
  id         INT          PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(120) NOT NULL,
  comment    TEXT         NOT NULL,
  rating     TINYINT      NOT NULL DEFAULT 5,  -- 1..5
  approved   TINYINT(1)   NOT NULL DEFAULT 0,  -- 1 = show on site
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_testimonials_approved (approved),
  INDEX idx_testimonials_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Contacts (public contact form)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
  id         INT           PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(120)  NOT NULL,
  email      VARCHAR(255)  NOT NULL,
  country    VARCHAR(100)  NOT NULL,
  `Company`  VARCHAR(150)  NULL,
  message    TEXT          NOT NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contacts_email    (email),
  INDEX idx_contacts_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Blog posts (controller charts use COALESCE(published_at, created_at))
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_posts (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  slug         VARCHAR(160)  NOT NULL UNIQUE,
  title        VARCHAR(200)  NOT NULL,
  excerpt      VARCHAR(400)  NULL,
  html         MEDIUMTEXT    NULL,        -- sanitized HTML
  image        VARCHAR(400)  NULL,        -- /img/blog/xxx.jpg
  tag_slug     VARCHAR(80)   NULL,
  tag_name     VARCHAR(80)   NULL,
  read_mins    INT           NULL,
  published_at DATETIME      NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_blog_published (published_at),
  INDEX idx_blog_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Recycle bin (soft delete snapshots)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recycle_bin (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  entity_type  VARCHAR(50)   NOT NULL,
  original_id  INT           NULL,
  name         VARCHAR(255)  NULL,
  payload      JSON          NOT NULL,
  deleted_by   VARCHAR(255)  NULL,
  deleted_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_recycle_payload_json CHECK (JSON_VALID(payload)),
  KEY idx_type_date   (entity_type, deleted_at DESC),
  KEY idx_deleted_at  (deleted_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

