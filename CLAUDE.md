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
