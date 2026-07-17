# Cyflow Social — milestone progress

An honest, append-only log of the production build, most recent first. Each
milestone is one complete, tested, committed increment. Nothing here publishes to
a social provider yet.

## Milestone C3 — secure media uploads and asset library

**Branch:** `cyflow-social-v1` · **Migration:** `013_secure_media_library.sql`
(apply after 010 → 011 → 012)

- Businesses upload their own JPEG/PNG/WebP images and reuse them across posts, a
  Media library at `/media`, and a shared picker on Create Post and the Weekly
  Board drawer. Uploaded media works with no OpenAI or HCTI.
- Uploads are verified from the bytes (magic number, real dimensions, pixel cap,
  byte ceiling, SHA-256). GIF/SVG/BMP/TIFF/PDF/archive/animated-PNG/animated-WebP
  /polyglot/corrupt files are refused with specific reasons. Dependency-free —
  verification, not processing.
- One storage abstraction with a local-filesystem adapter (S3-shaped for later).
  Bytes live under `MEDIA_STORAGE_PATH` outside the app source, under a
  server-generated random key, with two independent path-traversal guards. Bytes
  leave only through the ownership-checked token route (`nosniff`, `inline`).
- Ownership enforced at the service: cross-user requests are *not found* and make
  zero changes. User-scoped dedup never reveals another user's uploads. An in-use
  asset cannot be deleted silently; the error says how many posts use it without
  exposing a private id. References are a bounded polymorphic table
  (`media_asset_references`: `planner_run_item`, `scheduled_post`).
- New env: `MEDIA_STORAGE_DRIVER`, `MEDIA_STORAGE_PATH`, `MAX_MEDIA_UPLOAD_BYTES`.
  See the README's "Media storage configuration" for operations, including the
  read-only orphan reconciliation command `node tools/media-orphans.mjs`.
- Only new dependency: `multer` (memory storage, single image field, size limit),
  used purely to parse the multipart body; every real check runs on the bytes.

## Milestone C2 — platform-specific post editors and revision history

**Migration:** `012_platform_post_revisions.sql`

- Canonical per-platform copy (`platform_captions_json`) with a shared editor
  across Create Post and the Weekly Board; manual per-platform edits are
  preserved through regeneration, with a revision history and restore.

## Milestone C1 — per-user OpenAI credentials

**Migration:** `011_customer_openai_credentials.sql`

- Each user supplies and manages their own encrypted OpenAI credentials; the
  global key fallback was removed so generation always runs against the acting
  user's own key.
