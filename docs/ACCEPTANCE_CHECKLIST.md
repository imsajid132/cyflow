# Acceptance Checklist — Cyflow Social

Final acceptance conditions for a Hostinger-equivalent run. Every box must hold
before READY. No secrets. Re-verify after any change to generation, images,
automation, or providers.

## Content & plan
- [ ] A seven-day automation produces **7 posts** (once the worker drain has
      caught up in single-process mode).
- [ ] **0 generation failures** (`quality_status = generation_failed`).
- [ ] Correct **chronological order** on the Weekly Board (by scheduled instant,
      not generation order).
- [ ] The **exact Make day rhythm** (day-type → pillar/template) is followed.
- [ ] **Several services** are represented across the week (not collapsed to one).
- [ ] **No unsupported facts** — no invented statistics, prices, guarantees.
- [ ] **No fake reviews** — the testimonial slot uses a real stored review or a
      maintenance fallback.
- [ ] No em/en dashes in generated copy.

## Images & provider errors
- [ ] **7 ready images**, OR for any missing image a **visible, specific reason**
      (e.g. "Image failed / HCTI · Credits exhausted") — **never a silent
      "No image"**.
- [ ] **0 silent No-image states**: every non-ready image has a persisted
      `image_status` and, when failed, a safe category + message.
- [ ] Provider errors are **visible** (board/drawer + toast) and **survive a
      normal refresh**.
- [ ] **Retry image** re-renders WITHOUT rewriting the approved caption.
- [ ] A **media persistence** failure is distinguished from an HCTI **render**
      failure.
- [ ] Integrations shows a **masked credential fingerprint** and optional
      **connection label**; the full key is never shown.

## Targeting & queue
- [ ] Posts target the **exact selected Facebook Page** only.
- [ ] One selected account → **one queue target** (no fan-out).
- [ ] **Queue idempotency**: a second Queue click queues nothing.

## Safety
- [ ] **Zero real provider publishing calls** (Facebook/Instagram/Threads).
- [ ] `ENABLE_LIVE_PROVIDER_PUBLISHING=false` confirmed (`/health` +
      `publish=disabled` in the log).
- [ ] No real OpenAI/HCTI calls in automated tests (network boundary mocked).
- [ ] **No secrets** in logs, memory files, or safe columns.
- [ ] Internal DB IDs are not shown in the normal UI (structured logs only).

## Diagnostics
- [ ] The automation diagnostics explain **expected vs created vs completed vs
      failed** so "only 2 of 7" is understandable at a glance.
- [ ] Each missing image's provider **error category** is recorded and shown.

## Gates (must pass before READY)
- [ ] `npm test` (unit) green.
- [ ] `npm run test:integration` (disposable MariaDB) green.
- [ ] Authenticated browser E2E for the error scenarios green.
- [ ] `npm run migrate:check` PASS.
- [ ] `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities.
- [ ] Secret / raw-blueprint / provider-call scans clean.
- [ ] `npm run project:handoff` passes (memory files present + headed + current).
- [ ] Revert-verify: each focused fix fails its test when reverted, then restored.
