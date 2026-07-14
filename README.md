# Cyflow Social

A web-based platform to **generate**, **schedule**, and **automatically publish**
social media content — captions and images — to your connected accounts.

> **Status: Phase 4 — content generation & scheduling.** Completed so far: the
> Phase 1 foundation, Phase 2 auth + HCTI, Phase 3 OAuth connections, **plus**
> centralized **OpenAI** caption generation, per-user **HCTI** image generation
> from trusted templates, a safe **media proxy**, post **drafts**, target
> selection with per-account caption overrides, **scheduling** (timezone → UTC),
> the **scheduled queue**, cancellation/deletion, and **API-usage metering**.
>
> **NOT implemented yet:** provider **publishing** (Facebook/Instagram/Threads
> posts), the **cron publishing** pipeline, an automatic **token-refresh cron**,
> and post analytics. **Scheduling saves a validated post for a future
> publishing phase — nothing is published, and `scheduler:once` never publishes.**
> **App Review approval is NOT claimed.**

## Phase 4 — content generation & scheduling

### Centralized OpenAI (never user-provided)

Caption generation uses ONE backend OpenAI key (`OPENAI_API_KEY`) with the
configured model (`OPENAI_TEXT_MODEL` — never hardcoded). Users never enter or
see a key; it is never returned to the frontend or logged. OpenAI is "available"
only when `OPENAI_API_KEY` + `OPENAI_TEXT_MODEL` are both set (production fails
clearly on partial config). All user text is treated as data — the trusted
system prompt forbids following embedded instructions, and connected-account
tokens / HCTI credentials / emails are never sent to OpenAI.

Content flow: save a draft → select active target accounts → **Generate content**
(one caption + separate hashtags per selected platform, plus a short image
headline/subheadline/alt text) → edit any caption → **Generate image**.

### HCTI image generation

`POST /api/posts/:id/generate-image` renders the image with the **user's own
verified HCTI credentials** (decrypted only in memory), using trusted
server-owned templates — **minimal**, **bold**, **professional** — at
**square 1080×1080**, **portrait 1080×1350**, or **landscape 1200×630**, with a
safe background preset. User text is HTML-escaped and the HTML is sanitized
(defence-in-depth): no scripts, iframes, forms, event handlers, or arbitrary
CSS/URLs.

### Media proxy

`GET /media/:publicToken` serves ready, unexpired assets by an **opaque random
token** (never a DB id), proxied only from the **trusted HCTI host** (SSRF-safe;
no client URLs), with a timeout, max byte-size, image-only content types,
`X-Content-Type-Options: nosniff`, and a cache policy. Base64 image data is never
stored in MySQL.

### Post & scheduling endpoints (all auth; state-changing = CSRF)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/posts/capabilities` | OpenAI/HCTI availability + daily-generation usage |
| GET | `/api/posts` | list drafts/queued (paginated, sanitized) |
| POST | `/api/posts` | create draft |
| GET | `/api/posts/:id` | get a post + targets + media preview |
| PATCH | `/api/posts/:id` | update draft (no privileged fields) |
| POST | `/api/posts/:id/generate-content` | OpenAI (strict rate limit) |
| POST | `/api/posts/:id/generate-image` | HCTI (strict rate limit) |
| PUT | `/api/posts/:id/targets` | select accounts + caption overrides |
| POST | `/api/posts/:id/schedule` | queue for a future publishing phase |
| POST | `/api/posts/:id/cancel` | cancel a pre-publication post |
| DELETE | `/api/posts/:id` | delete a draft (blocked if published history) |
| GET | `/media/:publicToken` | public, SSRF-safe image proxy |

### Timezone & UTC

Scheduling takes a **local date + time** and the user's **IANA timezone**,
converts to the UTC instant (via `Intl`), stores `scheduled_at_utc` (UTC) plus
the `original_timezone`, and rejects past times and invalid zones. Example:
`14:30 Asia/Karachi` → `09:30 UTC`.

### Daily generation limit & metering

Each successful/failed OpenAI content call and each HCTI image call is recorded
in `api_usage` (safe accounting only — never prompts, captions, tokens, or
keys). Both operation types count toward `MAX_DAILY_GENERATIONS_PER_USER`
(default 100) over a rolling 24h window; the limit is enforced before each
generation.

### Migration 005

Phase 4 adds a few columns to `scheduled_posts` (aspect ratio, background style,
image alt text, generation params, generation timestamps). Apply
[`005_phase4_generation_scheduling.sql`](database/migrations/005_phase4_generation_scheduling.sql)
to an existing database (additive only, no data reset); fresh installs get them
from `schema.sql`. **No new environment variable is required** (OpenAI/HCTI vars
already existed).

### Manual smoke test

Sign in → **Create Post**: enter a brief + brand, pick tone/template/aspect,
check an active account, **Save draft**, **Generate content** (edit captions per
platform), **Generate image** (preview appears), set a **schedule date/time**,
**Schedule post** → it appears in **Scheduled Queue** as *queued* (not
published). Use the queue to **Edit**, **Cancel**, or **Delete**.

> Publishing is still unfinished: no Facebook/Instagram/Threads post is created,
> and `npm run scheduler:once` only reports the queue (0 published).

## Phase 3 — OAuth account connections

Connect and manage social accounts (no publishing yet).

### Supported providers & least-privilege scopes

| Provider | Account type | Scopes requested |
|---|---|---|
| Facebook Pages (`meta`) | `facebook_page` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Instagram (`instagram`) | `instagram_professional` | `instagram_business_basic`, `instagram_business_content_publish` |
| Threads (`threads`) | `threads_profile` | `threads_basic`, `threads_content_publish` |

Only these three are supported. TikTok, Pinterest, X, LinkedIn, YouTube,
WhatsApp, personal Instagram accounts, and personal Facebook profile publishing
are **out of scope**.

### Required environment variables (per provider)

```
META_APP_ID= / META_APP_SECRET= / META_GRAPH_API_VERSION= / META_REDIRECT_URI=
INSTAGRAM_APP_ID= / INSTAGRAM_APP_SECRET= / INSTAGRAM_GRAPH_API_VERSION= / INSTAGRAM_REDIRECT_URI=
THREADS_APP_ID= / THREADS_APP_SECRET= / THREADS_GRAPH_API_VERSION= / THREADS_REDIRECT_URI=
OAUTH_STATE_TTL_MINUTES=10 / OAUTH_HTTP_TIMEOUT_MS=30000 / OAUTH_TOKEN_REFRESH_LEEWAY_MINUTES=10
```

A provider is **available** only when its app id, app secret, Graph API version,
and redirect URI are all set. Graph API versions are **never** hardcoded. In
production, redirect URIs must be absolute **HTTPS** URLs and an enabled-but-
partial provider fails startup with a sanitized error.

### Exact callback paths

The redirect URI env var must match the corresponding callback exactly:

```
https://cyflow.cyfrow.net/api/oauth/meta/callback
https://cyflow.cyfrow.net/api/oauth/instagram/callback
https://cyflow.cyfrow.net/api/oauth/threads/callback
```

### API endpoints

| Method | Path | Auth | CSRF | Notes |
|---|---|---|---|---|
| GET | `/api/oauth/providers` | user | — | availability only (no ids/secrets) |
| POST | `/api/oauth/:provider/start` | user | ✅ | returns a server-built `authorizationUrl` |
| GET | `/api/oauth/:provider/callback` | user | — (state protects) | consumes state, redirects to `/dashboard?oauth=...` |
| GET | `/api/social-accounts` | user | — | sanitized, token-free list |
| POST | `/api/social-accounts/:id/verify` | user | ✅ | refresh (if supported) + verify |
| DELETE | `/api/social-accounts/:id` | user | ✅ | body `{ "confirm": "DISCONNECT" }` |

### Threads compliance callbacks (uninstall & data deletion)

Server-to-server webhooks from Meta/Threads, authenticated by a `signed_request`
(HMAC-SHA256 verified with `THREADS_APP_SECRET`) — **no session or CSRF**.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/oauth/threads/uninstall` | signed_request | removes the matching Threads connection + tokens |
| POST | `/api/oauth/threads/data-deletion` | signed_request | removes data; returns `{ url, confirmation_code }` |
| GET | `/api/oauth/threads/data-deletion/status/:confirmationCode` | public | simple non-personal status |

On a valid uninstall/data-deletion the matching Threads account(s) are found by
the signed_request `user_id`; their tokens are erased and the connection is
deleted (or **revoked** when publish history must be preserved). The
data-deletion response is exactly `{ "url": "…/status/<code>", "confirmation_code": "<code>" }`,
where the base URL comes from `PUBLIC_BASE_URL` (production:
`https://cyflow.cyfrow.net/api/oauth/threads/data-deletion/status/<code>`). The
status endpoint reports `received`/`completed` **without any personal data**.
Invalid signatures are rejected; signed requests, tokens, secrets, and provider
user ids are never logged. **No new environment variable is required** — the
existing `THREADS_APP_SECRET` and `PUBLIC_BASE_URL` are reused. A migration
[`004_threads_data_deletion.sql`](database/migrations/004_threads_data_deletion.sql)
adds a `data_deletion_requests` receipts table.

### State & replay protection

OAuth `state` carries ≥32 random bytes; only its **SHA-256 hash** is stored.
State is consumed **exactly once** (atomic `SELECT ... FOR UPDATE`), and is
verified for matching provider, non-expiry (TTL), the authenticated user, and
the exact configured redirect URI. Replayed, expired, cross-user, forged, and
redirect-mismatched states are all rejected. Raw state and authorization codes
are never logged (see request-log redaction below).

### Token encryption & refresh

Every access/refresh token is encrypted with **AES-256-GCM** before any DB
write and decrypted only in memory immediately before a provider call. Tokens,
ciphertext, IVs, and auth tags are never returned to the frontend. Token
lifetimes come from the provider's `expires_in` (never hardcoded). Instagram and
Threads long-lived tokens are refreshed via their official refresh endpoints
when near the configured leeway; Facebook Page tokens have no conventional
refresh (a reconnect is required if they become invalid).

### Local disconnect

Disconnecting removes the account **locally only** — it never broadly
deauthorizes the provider app and never affects other connected accounts. If a
disconnected account is referenced by published-post history (later phases), it
is marked **revoked** with its tokens securely erased instead of being deleted,
preserving audit history.

### Request-log redaction

OAuth callback URLs carry sensitive query params. The HTTP logger uses a
redacted URL token — `code`, `state`, `access_token`, `refresh_token`,
`client_secret`, and `error_description` are replaced with `REDACTED` and the
full raw callback URL is never written. Pathname + status remain in the log.

### Tester/developer requirements before App Review

Until each Meta/Instagram/Threads app passes **App Review**, only users added as
**app roles** (admins/developers/testers) — with the requested permissions
granted to them — can complete these OAuth flows. This is a Meta platform
requirement, external to Cyflow. This project does **not** claim App Review
approval, business verification, or that live publishing is enabled.

### Manual OAuth smoke test

With a provider configured and its tester account, from the dashboard:

1. **Connected Accounts** → click **Connect** on a configured provider →
   complete consent → you return to `/dashboard?oauth=success&provider=...`.
2. The connected account appears with its status. Click **Verify** to re-check
   it, or **Disconnect** (confirm) to remove it locally.

> Publishing and scheduling remain **disabled** — Phase 3 only connects accounts.

## Phase 2 features

- **Authentication** — register, login, logout, current-user endpoint, all
  session-based (no tokens in the browser). Passwords hashed with **bcrypt**
  using the configured cost factor.
- **Sessions** — server-side store; the session holds only `userId` (+ a CSRF
  token), never a user record. Sessions are **regenerated** on
  register/login/password-change (fixation prevention) and **destroyed** on
  logout with the cookie cleared.
- **CSRF** — synchronizer tokens stored in the session; every state-changing
  request must send `X-CSRF-Token`; comparison is timing-safe; the token rotates
  after login/registration/password-change.
- **Profile** — edit name + timezone (IANA-validated). Privileged fields
  (role, status, email, password) can never be changed via the profile route.
- **HCTI credentials** — each user stores their own HCTI User ID + API Key,
  **encrypted with AES-256-GCM** before storage. The API never returns plaintext
  values, ciphertext, IVs, or auth tags — only `configured` / `verified` /
  `verifiedAt` / a masked User ID. Credentials can be saved, tested, and deleted.

### Password rules

At least **12** characters (max 128), containing at least one uppercase letter,
one lowercase letter, and one number. Symbols and spaces are allowed; the
password is never silently trimmed and a whitespace-only password is rejected.

### API endpoints

Auth (`/api/auth`):

| Method | Path | Auth | CSRF | Notes |
|---|---|---|---|---|
| POST | `/register` | guest | ✅ | rate-limited (5/hr/IP) |
| POST | `/login` | guest | ✅ | rate-limited (10/15min/IP); generic error |
| POST | `/logout` | user | ✅ | destroys session, clears cookie |
| GET | `/me` | user | — | fresh sanitized user from the DB |
| PATCH | `/profile` | user | ✅ | name + timezone only |
| POST | `/change-password` | user | ✅ | rate-limited; rotates session + CSRF |

HCTI integration (`/api/integrations`):

| Method | Path | Auth | CSRF | Notes |
|---|---|---|---|---|
| GET | `/hcti` | user | — | status only (configured/verified/masked) |
| PUT | `/hcti` | user | ✅ | encrypt + save; resets verification |
| POST | `/hcti/test` | user | ✅ | verifies credentials (**may consume one HCTI render**) |
| DELETE | `/hcti` | user | ✅ | body `{ "confirm": "DELETE" }` |

Plus Phase 1: `GET /health`, `GET /api/csrf-token`.

> ⚠️ **Testing HCTI credentials renders a tiny image and may consume one HCTI
> render/operation** against the user's account.

### Manual smoke test (local)

With a `.env` and a running MySQL (see below), start the server (`npm start`),
then in the browser:

1. Open `/` → create an account (pick a timezone; password must meet the rules).
   You are redirected to `/dashboard`.
2. On the dashboard, edit your **Profile** (name/timezone) and **Change
   password** (you stay signed in; the session rotates).
3. Under **HCTI Settings**, save your HCTI User ID + API Key, click **Test**
   (consumes one render), then **Delete**.
4. Click **Log out** → you return to `/` and `/dashboard` redirects you back to
   `/` while signed out.

## Supported platforms (v1)

- **Facebook Pages**
- **Instagram Professional**
- **Threads**

## Explicitly NOT supported in v1

- **TikTok**
- **Pinterest**
- **X (Twitter)**
- LinkedIn, YouTube, or any other provider

## Technology stack

- **Runtime:** Node.js 22 (engines require `>=20`), native ES modules
- **Server:** Express.js
- **Database:** MySQL via `mysql2/promise` (no ORM)
- **Sessions:** `express-session` + `express-mysql-session` (server-side store)
- **Security:** `helmet`, `express-rate-limit`, `express-validator`,
  `sanitize-html`, AES-256-GCM via built-in `node:crypto`, `bcrypt`
- **Frontend:** HTML5 + Tailwind CSS (via CDN) + vanilla JS + Fetch API
- **Scheduling (later phase):** `node-cron`, `p-limit`
- **AI (later phase):** official OpenAI Node.js SDK
- **Hosting:** Hostinger Node.js Web App + Hostinger MySQL

## Folder structure

```
cyflow-social/
├── database/
│   └── schema.sql            # Importable MySQL schema (InnoDB, utf8mb4, UTC)
├── public/                   # Static frontend (served by Express)
│   ├── index.html            # Landing / auth shell
│   ├── dashboard.html        # Dashboard shell
│   ├── 404.html
│   └── assets/               # app.js, page scripts, favicon
├── src/
│   ├── app.js                # Express app wiring
│   ├── server.js             # Entrypoint: validate, verify DB, listen
│   ├── container.js          # DI wiring (repos → services → controllers)
│   ├── shutdown.js           # graceful close helpers
│   ├── config/               # env.js (validated config) + constants.js
│   ├── controllers/          # auth, integration, oauth, socialAccount, post, media, threadsCallback
│   ├── db/                   # pool.js + transactions.js
│   ├── middleware/           # requestId, errorHandler, rateLimits, validate, auth, csrf
│   ├── providers/            # baseProvider, meta/instagram/threads, providerRegistry
│   ├── repositories/         # user, integration, log, oauthState, socialAccount, post, mediaAsset, apiUsage, dataDeletion
│   ├── routes/               # health, csrf, auth, integration, oauth, socialAccount, post, media
│   ├── services/             # encryption, auth, hcti, logging, oauth, openaiContent, socialImage, mediaAsset, post, threadsCallback
│   ├── templates/            # socialImageTemplates (trusted HTML/CSS)
│   ├── validators/           # auth, integration, socialAccount, post, threadsCallback
│   ├── scheduler/            # runOnce.js (reports queue; does NOT publish)
│   └── utils/                # errors, redaction, validation, time, session, providerHttp, oauthErrors, signedRequest, asyncHandler, apiResponse
└── tests/                    # node:test + supertest (with in-memory fakes)
```

## Local installation

Requires **Node.js 20+** (target 22) and a MySQL database.

```bash
npm install
cp .env.example .env         # then fill in the values (see below)
```

## Environment setup

Copy `.env.example` to `.env` and set the values. The server validates
configuration at startup and refuses to boot with a clear (secret-free) error
if anything required is missing or malformed.

External provider credentials (Meta / Instagram / Threads / OpenAI) are
**optional in development** — when absent, that provider is simply reported as
unavailable.

### Secret generation (Node.js)

Generate a 32-byte AES key (base64) for `ENCRYPTION_KEY_BASE64`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Generate a strong `SESSION_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
```

`ENCRYPTION_KEY_BASE64` **must decode to exactly 32 bytes** or startup fails.

## MySQL schema import

Import `database/schema.sql` into an empty database. It is compatible with
Hostinger's phpMyAdmin.

```bash
# CLI
mysql -h <host> -u <user> -p <database> < database/schema.sql
```

Or in phpMyAdmin: select the database → **Import** → choose `database/schema.sql`
→ **Go**. The schema is InnoDB, `utf8mb4`, uses foreign keys, and stores all
`DATETIME` values in UTC (the app connects with the session time zone set to
`+00:00`). It also creates the `sessions` table used by the session store.

## npm commands

| Command | Purpose |
|---|---|
| `npm start` | Start the production server (`src/server.js`). |
| `npm run dev` | Start with `nodemon` for local development. |
| `npm test` | Run the test suite (Node's built-in test runner). |
| `npm run test:watch` | Run tests in watch mode. |
| `npm run scheduler:once` | One-shot scheduler run (Phase 1: validates env + DB only). |

### Verify locally

With a valid `.env` and reachable MySQL:

```bash
npm start
# GET http://localhost:3000/health           -> status envelope
# GET http://localhost:3000/api/csrf-token    -> { data: { csrfToken } }
# GET http://localhost:3000/                   -> landing page
# GET http://localhost:3000/dashboard          -> dashboard shell
```

## Security model

- **OpenAI key is centralized.** There is exactly one admin OpenAI API key,
  supplied only via `OPENAI_API_KEY` in the backend environment. **Users never
  provide or see an OpenAI key.**
- **HCTI credentials are per-user and encrypted.** Each user supplies their own
  HCTI User ID and API Key. Both are encrypted with **AES-256-GCM**
  (`node:crypto`) before storage and are never returned in plaintext after
  saving.
- **Social tokens are encrypted.** Access and refresh tokens (from the official
  OAuth flows, later phase) are encrypted at rest in MySQL.
- **Encryption format** is versioned: `v1:<iv-base64>:<auth-tag-base64>:<ciphertext-base64>`
  with a 12-byte random IV and authentication-tag verification.
- **Redaction.** Structured logs and error contexts recursively redact secrets
  (passwords, tokens, authorization/cookie headers, client/app secrets, HCTI
  fields, OAuth codes).
- **HTTP hardening.** Helmet with a CSP, server-side sessions
  (`httpOnly`, `sameSite=lax`, `secure` in production), CSRF synchronizer tokens,
  rate limiting, and input validation/sanitization.

## ⚠️ Never commit `.env`

`.env` (and any `.env.*` except `.env.example`) is **git-ignored** and must
never be committed. It holds secrets: the encryption key, session secret,
database password, OpenAI key, and provider app secrets. Only `.env.example`
(placeholders, no values) is tracked.

## Security Status

Dependency audit (re-verified through Phase 3):

- **`npm audit`: 0 vulnerabilities.**
- **`npm audit --omit=dev` (production): 0 vulnerabilities.**
- No new dependencies were added in Phase 3 (OAuth uses native `fetch` + `node:crypto`).

Two dependencies were upgraded to patched majors after verifying compatibility:

| Package | From → To | Reason | Compatibility |
|---|---|---|---|
| `bcrypt` | 5.1.1 → 6.0.0 | Cleared high-severity `tar`/`node-pre-gyp` chain (bcrypt 6 uses prebuilt binaries, no `node-pre-gyp`) | `hash`/`compare` API unchanged; verified at runtime by `tests/bcrypt.test.js` |
| `node-cron` | 3.0.3 → 4.6.0 | Cleared moderate `uuid` advisory | Not yet used in code; `validate`/`schedule`/`stop` verified to import and run |

No high or moderate vulnerabilities remain unresolved. If a future audit surfaces
an advisory whose only fix is a breaking upgrade, it will be documented here
honestly rather than dismissed — unresolved high-severity issues are never
described as safe.

## Roadmap (later phases)

OAuth connection flows, OpenAI caption generation, HCTI image generation, the
`node-cron` publishing scheduler with retries, and provider publishing to
Facebook / Instagram / Threads are implemented in subsequent phases. This
README will be updated as those features land — nothing above is claimed as
complete before it is.
