# Connector Production Audit (Milestone 2 · Phase A)

Status of every connector surface, and the plan to make it production-ready.
"Real" = makes real API calls today. "Gap" = placeholder / missing.

## Framework

| Capability | State | Action |
|---|---|---|
| App interface (`run`) | Real | keep |
| Auth schemas (api_key / bearer / basic / oauth2) | Declared | keep |
| Connection vault (AES-256-GCM, redacted reads) | Real (Milestone 1) | keep |
| **Test connection** | **Gap** — no seam | ✅ add `App.testConnection` + `POST /connections/test` + UI button |
| OAuth2 authorize URL | Real (buildAuthorizationUrl) | keep |
| **OAuth2 token exchange / callback** | **Gap** — scaffold returns a message | Phase B: wire exchange + encrypted token storage |
| **OAuth2 refresh / reconnect / disconnect / expiry** | **Gap** | Phase B |
| Retry logic | Partial — BullMQ job retries (worker) | connector-level retry helper (follow-up) |
| Output schemas | Ad-hoc return shapes | document per module (ongoing) |

## Per-connector

| App | Auth | Modules today | Gaps |
|---|---|---|---|
| HTTP (built-in) | none/conn | make_request | pagination helpers (follow-up) |
| Webhook (built-in) | none | custom_webhook trigger | ✅ real public receiver (Milestone 1) |
| **Telegram** | api_key | send_message only | ✅ **this commit: full Bot API** (send*/edit/delete/forward/copy/answer/pin/get_chat/get_member/get_file/commands/webhook mgmt/get_updates) + testConnection |
| OpenAI | bearer | create_completion | + testConnection (this commit); more models/embeddings (follow-up) |
| Slack | bearer | send_message | + testConnection (this commit); channels/search (follow-up) |
| Gmail | oauth2 | send_email | Phase B OAuth flow; list/search/watch (Phase C) |
| Google Sheets | oauth2 | append_row | Phase B OAuth flow; read/update/search (Phase C) |
| Google Drive/Calendar/Docs | — | not built | Phase B/C |
| Discord/Notion/Airtable/GitHub/GitLab/Dropbox/OneDrive/Cloudflare/Supabase/RSS/JSON-CSV | — | not built | Phase C |

## Frontend UX gaps

- OAuth "Connect" button surfaces a "setup required" scaffold message → real once Phase B lands.
- No **Test connection** / **Reconnect** / **Disconnect health** on the connection row → add (Test now; Reconnect/health with OAuth in Phase B).
- Missing loading/success/error states on connection actions → add.

## Plan (priority order, per the milestone)

1. **This commit** — framework `testConnection`; production Telegram connector (real Bot API) with tests; `POST /connections/test` + UI Test button; catalog + demo mocks for new Telegram modules.
2. Phase B — full Google OAuth (exchange/refresh/reconnect/disconnect/multi-account), shared provider for Gmail/Sheets/Drive/Calendar.
3. Phase C — Top-20 connectors, each with triggers/searches/actions/schemas/errors/retry/pagination, in priority order.

Every connector that ships is real and tested — no scaffolds, no TODOs.
