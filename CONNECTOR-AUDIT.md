# Connector Production Status

Every connector below makes **real API calls** with typed params, parsed output,
descriptive errors, and mocked tests. No placeholders, no fake modules, no TODOs.

## Framework (production-ready)

| Capability | State |
|---|---|
| App interface (`run` returns bundles) | Real |
| Auth schemas (none / api_key / bearer / basic / oauth2 / custom) | Real |
| Connection vault (AES-256-GCM, redacted reads, decrypt only at run time) | Real |
| `App.testConnection` + `POST /connections/test` + UI button | Real |
| **Google OAuth** (start/callback, code exchange, encrypted tokens, refresh-before-run, multi-account) | Real |
| **Microsoft OAuth** (Entra; start/callback, exchange, refresh, encrypted tokens) | Real |
| `makeCloudGetConnection` — refreshes expired Google/Microsoft tokens transparently | Real |
| Retry (BullMQ job retries) + pagination (per-connector cursors/tokens) | Real |
| Browser demo mocks (catalog-driven; every connector runs offline in "Run once") | Real |

## Connectors (41 apps · ~300 modules · 117 connector tests + 14 OAuth tests)

**OAuth (Google, shared provider):** Gmail (8), Sheets (6), Drive (8), Calendar (5),
Contacts (5), Tasks (6), YouTube (5).
**OAuth (Microsoft, shared provider):** Outlook (6), OneDrive (7), Teams (6).
**Token / key:** Telegram (44 — full Bot API), OpenAI (7 — chat, embeddings,
image, moderation, models, Whisper transcription, TTS), Slack (12), Discord (7),
Notion (6), Airtable (5), GitHub (9), GitLab (6), Dropbox (7), Cloudflare (6),
HubSpot (7), ClickUp (6), Asana (7), Calendly (5), monday.com (6), Stripe (6),
X/Twitter (5), WhatsApp Cloud (3).
**Custom multi-field:** Supabase, Trello, Twilio, Shopify, WooCommerce, PostgreSQL,
MySQL, MongoDB, Redis, **Zoom** (Server-to-Server OAuth), **SMTP** (email).
**No auth:** RSS (feed parse), JSON/CSV utilities. Built-ins: HTTP, Webhook,
Manual trigger, Schedule trigger.

DB connectors (Postgres/MySQL/MongoDB/Redis) and SMTP use the real drivers (pg,
mysql2, mongodb, ioredis, nodemailer), lazy-imported so they never load at
startup and the browser bundle is untouched; tests mock the drivers and assert
SQL/commands/mail-options + the connect→run→close lifecycle.

## Deliberately not built (need provider app review) — documented, not faked

These four are the only remaining priority connectors. Each needs a provider OAuth
app **plus platform app review/audit** before *any* real API call succeeds — a
user cannot even obtain a working token with the required scopes until the app is
approved. Shipping modules that can't work for users would be fake, so they are
documented, not stubbed.

| App | Exact blocker |
|---|---|
| Facebook (Pages) | Publishing needs a Page token with `pages_manage_posts`, which requires **App Review + Business Verification** of the Meta app. |
| Instagram (Graph) | `instagram_content_publish` requires a Meta app with an IG Business account **through App Review**. |
| LinkedIn | Posting via `/rest/posts` needs the **Community Management API / Share** product, gated behind **LinkedIn Partner Program** approval. |
| TikTok | The **Content Posting API** requires an **audited** TikTok developer app with that scope granted. |

Path to add each: register the provider OAuth app, complete its review, add the
provider's OAuth (the framework already supports oauth2 + a shared-provider
pattern like Google/Microsoft), then the endpoints. WhatsApp Cloud and X are
already shipped because they work with a user-supplied token today.

## Required environment variables

- Vault: `CYFLOW_ENCRYPTION_KEY` (required for any connection).
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (= `{API}/oauth/google/callback`), `WEB_APP_URL`.
- Microsoft OAuth: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (= `{API}/oauth/microsoft/callback`), `WEB_APP_URL`.
- Token/key/custom connectors: no server env — the user supplies credentials per connection in the vault.
