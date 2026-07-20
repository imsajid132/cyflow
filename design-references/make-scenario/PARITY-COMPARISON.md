# Make.com → Cyflow parity comparison

Side-by-side of the proven Make.com "Daily Content Generator" output and the
native Cyflow reproduction. The goal is not byte-for-byte duplication: it is the
same weekly rhythm, the same caption cadence and the same card compositions,
filled with the current workspace's own business, brand and copy.

Rendered evidence: `.render-review/contact-sheet.png` (10 cards, real 1080×1080
through the production sanitization path, three different brands).

---

## 1. Weekly rhythm — day by day

### Local contractor / service (6 of 7 Make scenarios share this)

| Day | Make `content_type` → `image_template` | Cyflow day type → concept → layout |
|---|---|---|
| Mon | service_spotlight → service_card | service_spotlight → service_card → poster-service |
| Tue | trust_stat → stat_card | trust_stat → stat_card → poster-stat |
| Wed | nyc_code_tip → cheatsheet | code_tip → cheatsheet → poster-cheatsheet |
| Thu | project_showcase → project_card | project_showcase → project_card → poster-project |
| Fri | customer_testimonial → testimonial | testimonial_spotlight (real review) OR maintenance_tip fallback |
| Sat | pro_tip_warning → warning_card | pro_tip_warning → warning_card → poster-warning |
| Sun | brand_insight → quote_card | brand_insight → quote_card → poster-quote |

`nyc_code_tip` → `code_tip`: the "nyc" is dropped so the location is dynamic.
Friday is the one gated deviation — a fabricated review is forbidden, so the
testimonial card renders only with a real stored review, else the maintenance
tip the sixth scenario already used.

### Agency / SaaS / knowledge (the Peralytics scenario)

| Day | Make `content_type` → `image_template` | Cyflow day type → concept → layout |
|---|---|---|
| Mon | educational_tip → cheatsheet | educational_tip → cheatsheet → poster-cheatsheet |
| Tue | geo_insight → quote_card | category_insight → quote_card → poster-quote |
| Wed | hot_take_myth → comparison | hot_take_myth → comparison → poster-comparison |
| Thu | how_to_guide → cheatsheet | how_to_guide → cheatsheet → poster-cheatsheet |
| Fri | industry_trend → quote_card | industry_trend → quote_card → poster-quote |
| Sat | quick_hack → cheatsheet | quick_hack → cheatsheet → poster-cheatsheet |
| Sun | thought_leadership → quote_card | thought_leadership → quote_card → poster-quote |

`geo_insight` → `category_insight`: "GEO" is one agency's service category, so
it is generalised. Every other day matches the Make image_template exactly.

---

## 2. Caption cadence

| Aspect | Make | Cyflow |
|---|---|---|
| Opening | direct, specific statement | CADENCE rule: "open with a direct, specific statement" |
| Body | short explanation, numbered where useful | assignment writing guidance per slot |
| Takeaway | one practical takeaway | "land one practical takeaway the reader can act on" |
| CTA | one concise CTA | "close with ONE concise call to action, not a paragraph" |
| Hashtags | separate block, 4–7 | stored separately; per-platform ceilings (FB ≤3, IG 3–6, Threads ≤2) |
| Punctuation | no emojis, plain lists | no emojis, em/en dash forbidden, plain prose |
| Honesty | real values only | no invented stats, prices, reviews, awards |

Difference of intent: the Make FB post targeted 180–280 words; Cyflow keeps its
tuned 2–4 paragraph band (per CLAUDE.md) and the same punchy cadence. The
structure is reproduced; the length follows Cyflow's house rule.

---

## 3. Card composition — measurable tokens

Every Make hex is replaced by a palette role. `brand`/`brandDeep` = the field,
`accent` = the red, `onBrand` = white ink, muted greys = onBrand at reduced
opacity. Canvas, insets, type scale and block structure are reproduced.

| Token | Make `shared_css` | Cyflow `poster.js` |
|---|---|---|
| Canvas | 1080×1080, device_scale 2 | 1080×1080, HCTI @2 |
| Inset | `padding: 80px` | `.content { padding: 80px }` |
| Card flow | `flex-column; justify-content: space-between` | `.poster { flex-column; justify-content: space-between }` |
| Top bar | 12px accent bar | 12px accent bar (`.poster-topbar`) |
| Field treatment | 60px accent grid + radial orb | 60px grid + radial glow (dynamic accent) |
| Wordmark | CSS text "NYC" 60px/900 | real logo, else brand-name wordmark 40px/800 |
| Badge | bordered, 16px/800, 2.5px tracking | 17px/800, 2.5px tracking, bordered (dark) / solid (light) |
| Eyebrow | 36×6 accent bar + 20px/900 4px caps | 40×6 accent rule + 20px/800 4px caps |
| Headline | 80px/900, −2.5px, one accent span | 78px/800, −2px, one accent span |
| Service blocks | 3 left-accent blocks, label 18px + text 28px | 3 left-accent blocks, label 17px + text 27px |
| Mega stat | 340px/900, −14px | 300px/800, −12px |
| Trust badges | left-accent, 20px/900 | left-accent, 20px/800 |
| Cheatsheet tips | white card, 62px num chip, main 28px + sub 18px | white card, 56px num chip, main 27px + sub 18px |
| Warning fix block | green (#22C55E) left border | green (#22C55E) left border (semantic, not brand) |
| Quote text | 96px/900, −3px | 92px/800, −3px |
| Footer | hairline + two-sided lockup, accent right | hairline + two-sided lockup, accent right |
| Cards per week | light/dark/accent rotation | light (cheatsheet/comparison) / dark / accent (testimonial) |

Weight is 800 not 900 because Inter's 900 is heavier than most brand display
faces; 800 holds across the arbitrary fonts a workspace may set. Sizes step
down slightly to keep dynamic (longer, non-curated) copy inside each band.

---

## 4. What changes per workspace, and what never does

Dynamic (per workspace): business name, service, topic, city, phone, website,
CTA, logo, primary/secondary/accent colour, fonts, image subject, real facts,
real reviews.

Never copied from a Make example: any business name, the CSS "NYC" mark, the
red/navy or violet palette, phone numbers, addresses, service lists, social
account ids, or private data. A test scans the engine for all of them.

Proven by the contact sheet: the same service composition renders navy-and-red
for NYC Waterproofing, green for GreenLeaf Landscaping (no logo → wordmark), and
violet for a knowledge business — same layout, different brand.

---

## 5. Deliberate, documented divergences from the Make source

These are the places the native engine intentionally differs. None changes the
rhythm, composition or per-workspace branding; each is recorded honestly so
parity is not overclaimed.

| Aspect | Make.com source | Cyflow native | Why |
|---|---|---|---|
| Model | `gpt-4o-mini` | `OPENAI_TEXT_MODEL` (GPT-5 class; never hardcoded) | gpt-4o-mini is superseded; the closest supported model is selected, not silently substituted. |
| Sampling | `temperature: 0.85`, `max_tokens` | Responses API + strict JSON-Schema Structured Outputs, `reasoning.effort:'minimal'`, `max_output_tokens`; no `temperature` | The Responses API does not take `temperature` for these models; Structured Outputs guarantees the JSON contract the Make `json_object` only requested. |
| Request shape | one call returns all platforms + `image_data` | one call per post per platform; poster fields via `POSTER_SCHEMA_GROUPS` | Per-platform voice differentiation and the strict schema. The `image_data` field contract is preserved. |
| Friday (contractors) | 5 of 6 scenarios ran a FABRICATED `customer_testimonial` | testimonial ONLY when a real stored review exists, else `maintenance_tip` | The no-fake-review honesty rule. This is a deliberate, safer deviation from the Make majority. |
| Runtime platforms | Facebook (+ LinkedIn; Peralytics also IG/Pinterest) | Facebook, Instagram, Threads | LinkedIn and Pinterest are not Cyflow runtime targets. |
| Datastore dedup | Peralytics had an advisory `memory` blob | `contentUniquenessService` (fingerprint) + `contentStyleGuard` | A stronger, per-run duplicate/quality guard replaces the advisory blob. |

Caption authority (as of this milestone): the Make day-type's `format` is the
authoritative caption shape (`plannerBriefService` prefers `assignment.format`);
the generic pillar/content-mix only fills when the recipe assigns none. Locked
via `tests/makeParityGolden.test.js` and `tests/weeklyRhythm.test.js`. The
workspace phone is rendered in planner poster footers (parity with Make; the
planner path previously dropped it).
