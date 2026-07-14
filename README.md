# Cyflow Social

A web-based platform to **generate**, **schedule**, and **automatically publish**
social media content — captions and images — to your connected accounts.

> **Status: Phase 2 — Authentication & HCTI settings.** Completed so far:
> the Phase 1 foundation (config, schema, security utilities, Express server,
> health/CSRF), **plus** user registration/login/logout, sessions, profile
> editing, password change, and encrypted per-user HCTI credential management
> with a live credential test.
>
> **Not implemented yet** (later phases): Meta/Instagram/Threads **OAuth**,
> **OpenAI** caption generation, **HCTI image generation** in posts, **scheduled
> post creation**, the **cron publishing** pipeline, and provider **publishing**.
> Those areas remain clearly disabled in the UI.

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
│   ├── controllers/          # authController, integrationController
│   ├── db/                   # pool.js + transactions.js
│   ├── middleware/           # requestId, errorHandler, rateLimits, validate, auth, csrf
│   ├── repositories/         # userRepository, integrationRepository, logRepository
│   ├── routes/               # health, csrf, auth, integration routes
│   ├── services/             # encryption, auth, hcti, logging
│   ├── validators/           # authValidators, integrationValidators
│   ├── scheduler/            # runOnce.js (Phase 1 stub)
│   └── utils/                # errors, redaction, validation, time, session, asyncHandler, apiResponse
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

Dependency audit (Phase 1.1 hardening, 2026-07-15):

- **`npm audit`: 0 vulnerabilities.**
- **`npm audit --omit=dev` (production): 0 vulnerabilities.**

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
