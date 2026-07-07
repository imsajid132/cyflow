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

## Connectors (38 apps · ~230 modules · 103 connector tests + 6 OAuth tests)

**OAuth (Google, shared provider):** Gmail (8), Sheets (6), Drive (8), Calendar (5),
Contacts (5), Tasks (6), YouTube (5).
**OAuth (Microsoft, shared provider):** Outlook (6), OneDrive (7).
**Token / key:** Telegram (26), OpenAI (5), Slack (8), Discord (7), Notion (6),
Airtable (5), GitHub (9), GitLab (6), Dropbox (7), Cloudflare (6), HubSpot (7),
ClickUp (6), Asana (7), Calendly (5), monday.com (6), Stripe (6), X/Twitter (5),
WhatsApp Cloud (3).
**Custom multi-field:** Supabase, Trello, Twilio, Shopify, WooCommerce, PostgreSQL,
MySQL, MongoDB, Redis.
**No auth:** RSS (feed parse), JSON/CSV utilities. Plus built-ins: HTTP, Webhook.

DB connectors (Postgres/MySQL/MongoDB/Redis) use the real drivers (pg, mysql2,
mongodb, ioredis), lazy-imported so they never load at startup and the browser
bundle is untouched; tests mock the drivers and assert SQL/commands + the
connect→run→close lifecycle.

## Deliberately not built (need provider approval / different flow) — documented, not faked

| App | Why skipped | Path to add |
|---|---|---|
| Microsoft Teams | ChannelMessage.Send needs admin-consented Graph perms + team/channel context | Microsoft OAuth provider is already in place — add the connector + scope |
| Zoom | Server-to-Server OAuth (account_credentials token exchange) needs a Zoom OAuth app | add an S2S token fetch + api.zoom.us/v2 calls |
| Facebook, Instagram, LinkedIn, TikTok | Each requires its own OAuth app **+ platform app review** before real calls work | add per-provider OAuth + Graph/marketing endpoints once an app is approved |

These are honest gaps: the framework supports them, but real execution needs
credentials/approval the environment doesn't have. Nothing was stubbed to look done.

## Required environment variables

- Vault: `CYFLOW_ENCRYPTION_KEY` (required for any connection).
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (= `{API}/oauth/google/callback`), `WEB_APP_URL`.
- Microsoft OAuth: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` (= `{API}/oauth/microsoft/callback`), `WEB_APP_URL`.
- Token/key/custom connectors: no server env — the user supplies credentials per connection in the vault.
