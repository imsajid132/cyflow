# Cyflow Social

Permanent rules. Workflows live in `.claude/skills/`, not here.

## Social post copy

- Social text is **proper post copy**, not a one-line promotional caption.
  User-facing wording: "post copy", "Facebook post", "Instagram post",
  "Threads post". Internal field names stay as they are.
- Facebook and Instagram posts normally use **2–4 short paragraphs**
  (~100–180 words).
- Threads uses **shorter, platform-specific** post copy (~40–100 words). Never a
  trimmed Instagram post.
- **Em dash (—) and en dash (–) are forbidden** in generated copy. Use a period,
  comma, colon, parentheses, or a normal hyphen where grammar requires it.
- Never invent statistics, prices, guarantees or results. If a fact is not in the
  brief, leave it out.

## Design

- **Saved brand colours must be preserved exactly.** Assign roles (field / ink /
  accent / support); never mutate a valid saved hex into another hue. Only
  lightness may move, only for contrast, and it must be recorded. Never introduce
  a colour the business did not save.
- **Inspect `design-references/social-posts/` before any social-template work.**
  Look at the images; do not rely on a summary.
- **Visual changes require a rendered 1080×1080 review** through the production
  sanitization path, as a contact sheet, looked at.

## Judgement

- **Weak generic output must not be approved merely because tests pass.** Tests
  do not look at pictures or read for tone.
- Nothing publishes to a provider yet. Never imply otherwise in UI copy, comments
  or reports.

## Skills

- `cyflow-social-art-director` — creating or reviewing social image design.
- `cyflow-social-post-writer` — generating, editing or judging post copy.
- `cyflow-creative-quality-gate` — final combined review of a weekly plan.

## Project Continuity

At the START of every future session:

1. Read `PROJECT_MEMORY.md`.
2. Read `docs/AI_HANDOFF.md`.
3. Read `docs/KNOWN_ISSUES.md`.
4. Verify the actual git branch and HEAD (`git rev-parse --abbrev-ref HEAD`,
   `git rev-parse HEAD`, `git status`).
5. Do NOT trust a previous READY report without checking the latest live
   Hostinger evidence — the deployed commit is not assumed to match the repo.
6. Update the memory files before returning a final completion report.

At the END of every significant task:

- update completed work, remaining issues, and test totals;
- update the current release candidate and the next exact action;
- record any caveats honestly;
- never write secrets into memory files.

## Provider & job error visibility (permanent rules)

- No OpenAI, HCTI, Facebook, Instagram, Threads, scheduler, worker, image-render,
  media-storage or database failure may silently disappear. Every failure yields
  a safe structured log, a persisted safe state where relevant, a user-visible
  actionable message, and a correct retryable/non-retryable classification.
- Use the ONE normalized model: `src/utils/providerErrors.js`
  (`normalizeProviderError`, `ProviderError`) and `src/config/constants.js`
  `PROVIDER_ERROR_CATEGORY`. Never collapse a specific category into a generic
  code, and never turn a provider failure into a silent `null` / "No image".
- Never log or store an API key, access/refresh token, Authorization header, raw
  provider response, prompt, or generated post copy. Structured logs and the
  image/health columns carry only categories, safe messages, statuses and times.
- Live provider publishing stays OFF: `ENABLE_LIVE_PROVIDER_PUBLISHING=false` is
  the required state. No real Facebook/Instagram/Threads/OpenAI/HCTI call is made
  in automated tests (mock the network boundary only).
