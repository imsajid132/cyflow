# Acceptance Checklist — Cyflow Social

Final acceptance conditions for a Hostinger-equivalent run. No secrets. Re-verify
after any change to generation, images, automation, or providers.

STATUS: every box below is VERIFIED in the Hostinger-equivalent environment
(disposable MariaDB + the real app in headless Chrome + the real unit/integration
suites) as of the final verification session on branch `cyflow-social-v1`. The
ONE thing not verifiable from this workspace is the same run on the live host,
which is the single remaining redeploy + live-acceptance step.

## Content & plan
- [x] A seven-day automation produces **7 posts** (once the worker drain has
      caught up in single-process mode).
- [x] **0 generation failures** (`quality_status = generation_failed`).
- [x] Correct **chronological order** on the Weekly Board (by scheduled instant,
      not generation order).
- [x] The **exact Make day rhythm** (day-type → pillar/template) is followed.
- [x] **Several services** are represented across the week (not collapsed to one).
- [x] **No unsupported facts** — no invented statistics, prices, guarantees.
- [x] **No fake reviews** — the testimonial slot uses a real stored review or a
      maintenance fallback.
- [x] No em/en dashes in generated copy.

## Images & provider errors
- [x] **7 ready images**, OR for any missing image a **visible, specific reason**
      (e.g. "Image failed / HCTI · Credits exhausted") — **never a silent
      "No image"**.
- [x] **0 silent No-image states**: every non-ready image has a persisted
      `image_status` and, when failed, a safe category + message.
- [x] Provider errors are **visible** (board/drawer + toast) and **survive a
      normal refresh**.
- [x] **Retry image** re-renders WITHOUT rewriting the approved caption.
- [x] A **media persistence** failure is distinguished from an HCTI **render**
      failure.
- [x] Integrations shows a **masked credential fingerprint** and optional
      **connection label**; the full key is never shown.

## Targeting & queue
- [x] Posts target the **exact selected Facebook Page** only.
- [x] One selected account → **one queue target** (no fan-out).
- [x] **Queue idempotency**: a second Queue click queues nothing.

## Safety
- [x] **Zero real provider publishing calls** (Facebook/Instagram/Threads).
- [x] `ENABLE_LIVE_PROVIDER_PUBLISHING=false` confirmed (`/health` +
      `publish=disabled` in the log).
- [x] No real OpenAI/HCTI calls in automated tests (network boundary mocked).
- [x] **No secrets** in logs, memory files, or safe columns.
- [x] Internal DB IDs are not shown in the normal UI (structured logs only).

## Diagnostics
- [x] The automation diagnostics explain **expected vs created vs completed vs
      failed** so "only 2 of 7" is understandable at a glance.
- [x] Each missing image's provider **error category** is recorded and shown.

## Gates (must pass before READY)
- [x] `npm test` (unit) green.
- [x] `npm run test:integration` (disposable MariaDB) green.
- [x] Authenticated browser E2E for the error scenarios green.
- [x] `npm run migrate:check` PASS.
- [x] `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities.
- [x] Secret / raw-blueprint / provider-call scans clean.
- [x] `npm run project:handoff` passes (memory files present + headed + current).
- [x] Revert-verify: each focused fix fails its test when reverted, then restored.
