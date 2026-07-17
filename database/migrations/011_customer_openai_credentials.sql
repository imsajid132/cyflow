-- Milestone C1 — per-user OpenAI API credentials.
--
-- THE GAP THIS CLOSES. HCTI was already per-user, encrypted and versioned.
-- OpenAI was not: one global application key served every customer, cached in
-- module state and shared across users. Every customer's AI generation ran on
-- one credential and was billed to one account.
--
-- Additive and backward-compatible. Every column is nullable or carries a
-- default, so existing rows keep working untouched:
--
--   * a user_integrations row written before this migration has NULL
--     openai_api_key_encrypted, which the reader treats as "no OpenAI
--     integration configured" — the honest state, because it genuinely has none;
--   * the existing HCTI columns are NOT touched. hcti_user_id_encrypted,
--     hcti_api_key_encrypted, hcti_encryption_version and hcti_verified_at keep
--     their values and their meaning and stay readable with the current key.
--     This migration adds columns beside them and does nothing else.
--
-- The application encryption key is NOT rotated and nothing is re-encrypted.
-- openai_encryption_version mirrors hcti_encryption_version so a future
-- controlled rotation can tell which envelope a row was written with, without
-- making today's rows unreadable.
--
-- Scope is deliberately ONLY the OpenAI credential. Media upload metadata and
-- post revisions were drafted here and removed: their implementations are not
-- written, and shipping schema for a feature that does not exist would leave
-- columns nobody can explain. They get their own additive migrations (012, 013)
-- when C3 and C2 land.
--
-- Run order: after 010_weekly_content_rhythm.sql. No data backfill required.
-- Applied manually; this repository has no automated migration runner.

-- -----------------------------------------------------------------------------
-- user_integrations — per-user OpenAI API credentials
-- -----------------------------------------------------------------------------
--
-- These columns deliberately mirror the HCTI ones rather than inventing a
-- second scheme, so there is ONE credential pattern in this table and not two.
--
-- The key is stored ONLY as an AES-256-GCM envelope, v1:<iv>:<tag>:<ciphertext>,
-- with a fresh IV per write. VARCHAR(512) matches the HCTI columns and holds the
-- envelope for any real OpenAI key with room to spare.
--
-- Exactly four columns, and no more. An earlier draft carried a fifth
-- (openai_key_last_four) to avoid decrypting when rendering the masked hint —
-- but the HCTI path beside it already decrypts and calls maskSecret() for
-- exactly that, so the fifth column would have added a SECOND way to do one
-- thing. One pattern per table.
ALTER TABLE `user_integrations`
  ADD COLUMN `openai_api_key_encrypted` VARCHAR(512) NULL DEFAULT NULL
    COMMENT 'AES-256-GCM envelope of the customer OpenAI API key. Never plaintext.'
    AFTER `hcti_verified_at`,
  ADD COLUMN `openai_encryption_version` SMALLINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Envelope version, for a future controlled key rotation'
    AFTER `openai_api_key_encrypted`,
  ADD COLUMN `openai_model` VARCHAR(128) NULL DEFAULT NULL
    COMMENT 'Customer-selected OpenAI model. NULL means the application default.'
    AFTER `openai_encryption_version`,
  ADD COLUMN `openai_verified_at` DATETIME NULL DEFAULT NULL
    COMMENT 'Last time the key was proven to work. NULL means saved but unverified.'
    AFTER `openai_model`;
