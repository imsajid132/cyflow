# Cyflow Social

A web-based platform to **generate**, **schedule**, and **automatically publish**
social media content — captions and images — to your connected accounts.

> **Status: Phase 4.7.1 — planner controls, content quality, brand fidelity.**
> Fixes the planner's control and quality problems: explicit posts-per-day with
> a live plan summary, the full IANA timezone catalogue, safe plan deletion,
> human-sounding copy (no em dashes, no AI filler), and **exact brand-colour
> fidelity**.
>
> **Status: Phase 4.7 — auto content planner.** Adds the primary workflow:
> generate a week of posts, review them on a board, edit or regenerate any of
> them, approve, and queue. Includes a duplicate-prevention engine and three
> content-type image templates.
>
> **Status: Phase 4.6 — premium branded post design.** Rebuilds the image
> templates as a real design system: a derived brand palette, a length-aware
> type scale, and composed layouts.
>
> **Status: Phase 4.5b — multi-page UX + branded images.** Replaces the single
> dashboard page with a multi-page app (15 directly-loadable routes), a shared
> design system, and a three-step onboarding wizard.
>
> **Status: Phase 4.5a — business onboarding backend.** Adds the business
> profile model, an SSRF-hardened website analyzer, brand extraction, and the
> onboarding API.
>
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

## Phase 4.5b — multi-page UX & branded image templates

### Routes

The Express app serves one shell (`public/app.html`) for every application
route, so each URL below is directly loadable, bookmarkable, and refresh-safe.
Unknown page paths still return the HTML 404; unknown `/api/*` paths still
return the JSON 404 envelope.

| Route | Purpose |
| --- | --- |
| `/` | Entry point — redirects to the dashboard or login |
| `/login`, `/register` | Authentication |
| `/onboarding`, `/onboarding/business`, `/onboarding/brand`, `/onboarding/connections` | Three-step business setup wizard |
| `/dashboard` | Overview: setup state, counts, next scheduled posts, recent activity |
| `/brand` | Full business-profile editing with a live preview |
| `/connections` | Facebook Pages / Instagram Professional / Threads OAuth |
| `/create` | Brief → captions → branded image → schedule |
| `/queue` | Drafts, queued, cancelled, and failed posts |
| `/calendar` | Month view of scheduled posts in local time |
| `/integrations` | HCTI credentials + caption-generation availability |
| `/profile` | Name, timezone, password |
| `/settings` | Content defaults, setup state, usage today |

### Frontend architecture

Vanilla ES modules under `public/assets/js/`: a hash-free history router with
per-page dynamic imports, a `ui.js` DOM kit, `api.js` (fetch + CSRF), `nav.js`
(responsive sidebar/drawer), and one module per page under `pages/`. Styling is
a single design-token stylesheet (`assets/css/design-system.css`). Nothing is
loaded from a third-party origin — no CDN scripts, styles, or fonts.

### Frontend security invariants

Enforced by `tests/appShell.test.js`, which scans every frontend module:

- The **CSRF token lives in memory only**. No `localStorage`, `sessionStorage`,
  cookies, or `indexedDB` are used anywhere — for tokens, credentials, captions,
  website extracts, or OAuth state.
- **No untrusted value reaches `innerHTML`.** All text is set via `textContent`;
  the only `innerHTML` sinks are locally authored, constant SVG icons.
- **OAuth navigation is host-pinned.** The authorization URL's host must match
  the expected provider host (`www.facebook.com`, `www.instagram.com`,
  `threads.net`) before any navigation happens.
- Raw crawler, provider, OpenAI, and HCTI errors are never displayed — pages
  show safe, already-classified messages only.
- Nothing from an analyzed website is loaded as script, SVG, HTML, or a font.

## Phase 4.7.1 — planner controls, content quality, brand fidelity

### The brand-colour bug, and the fix

**Root cause.** Phase 4.6's `buildPalette` clamped every brand colour into a
lightness band of 32–56% so it could "carry a filled area". A near-black brand
primary — `#111827`, which is what most modern brands use — was **forced up to
L=32% and came out as an unrelated mid-blue**. That was the "unrelated purple or
blue" in the generated images.

**The fix.** Saved colours are now used **exactly**. Taste comes from ROLE
ASSIGNMENT, not from rewriting the hex:

| Role | Chosen as | Cyfrow example |
| --- | --- | --- |
| canvas | the darkest saved colour | `#111827` |
| accent | the most chromatic colour (CTA, emphasis) | `#FDC70F` |
| support | the next most chromatic | `#23A455` |

The only permitted change is a **readability nudge** when no ink could sit on a
fill (a mid-grey is the realistic case). Every nudge keeps the hue, moves the
lightness as little as possible, and is reported in `palette.adjusted`.
`palette.source` is `saved_brand_palette` or `fallback_palette`, so a mismatch
between the profile and a render is never a mystery. Defaults apply only when a
business has **no** valid saved colours; an all-white palette gets a neutral
near-black canvas rather than an invented hue.

### Posts per day

Explicit, 1–5, defaulting to **1**. It is never inferred from how many times
were selected — selecting two times and silently getting two posts a day was the
bug. Extra times are simply available slots. Selecting **fewer times than posts
per day is a validation error**, because inventing a posting time would publish
at an hour nobody approved.

`GET /api/planner/plans/summary` (POST) returns the count before generation, and
`generatePlan` validates against **the same function**, so the sentence the
wizard shows is a promise the server keeps:

> 7 active days × 2 posts per day = 14 posts.
> Posts will be created for Instagram and Threads at 10:00 and 18:00 in Asia/Karachi.

### Timezones

The full `Intl.supportedValuesOf('timeZone')` catalogue (400+ zones, every
continent), not a curated shortlist. Offsets are computed **for the planning
date** because they are not a property of a zone: Europe/London is UTC+00:00 in
January and UTC+01:00 in July. The canonical IANA id is stored; the offset is
display only.

Two findings worth noting: `Intl.DateTimeFormat` **accepts a bare `+05:00` as a
timeZone**, so validation checks the id's shape before trusting the runtime — an
offset must never be persisted. And a runtime's tzdata may file a city under its
old name (`Asia/Calcutta`), so search matches renamed cities both ways.

### Plan deletion

| Situation | Behaviour |
| --- | --- |
| drafts / planner-only items | deleted with the plan |
| a draft post copied out | kept — it is the user's own copy |
| **queued** posts | **refused**, unless the user explicitly chooses "Cancel queued posts and delete plan" |
| **published** posts | the plan is **archived**, never destroyed |

All in one transaction. Delete is available on the dashboard, history and weekly
board; the confirmation states the real impact, fetched from
`GET /api/planner/plans/:id/deletion-impact`.

### Content quality

`contentStyleGuard` runs on every generation, because instructions alone do not
hold:

- **Em/en dashes are repaired**, not rejected — the sentence around a dash is
  usually fine, so the character is swapped for the punctuation a person would
  have typed. Burning a generation over punctuation is waste.
- **Banned AI phrases force a regeneration** — "take your business to the next
  level" cannot be repaired by substitution, because the sentence has no content
  to keep.
- Headlines are held to 4–9 words and 62 characters, and the type scale steps
  down before allowing a stranded single-word line.
- Copy that still fails is marked **Needs rewrite** and never auto-approved.

Each platform gets its own voice (Facebook conversational, Instagram hook-first,
Threads one clear thought). Twelve strategic formats replace the old content
types, and a seven-post plan normally carries at least four.

### Content-to-design mapping

The layout follows the **shape of the message**, never a rotation for novelty:

| Format | Layout |
| --- | --- |
| checklist, process | Checklist Guide |
| comparison, myth/fact | Comparison Cards |
| educational insight, common mistake | Editorial Insight / Light Editorial |
| authority (with a real figure) | Stat Highlight |
| service benefit, soft promo | Service Authority |
| local relevance | Local Insight |

Formats are dealt out and then **spread by the layout they produce**, so two
formats that share a design (comparison and myth/fact) never land side by side.

## Phase 4.7 — auto content planner

The planner is the primary workflow. Manual **Create Post** still works
unchanged; it is now the exception rather than the default path.

### The flow

```
preferences → schedule → briefs → captions → duplication check → images
   → weekly board → edit / regenerate → approve → queue (future publishing)
```

1. `/planner` — dashboard: current plan, settings summary, setup blockers.
2. `/planner/new` — wizard: length, cadence, days, times, platforms, approval.
3. `/planner/week` — the board: every post grouped by day, with an edit drawer.
4. `/planner/history` — every plan generated.

Planner preferences (cadence, times, goals, content mix, tone, CTA mode,
approval mode, autopilot) live in **Settings → Auto planner**.

### How variation is engineered

Repetition is prevented before it is detected. Rather than asking a model for
"7 different posts" and hoping, the plan is dealt out in advance
(`plannerBriefService`): content types are allocated from the user's weighted
mix by largest-remainder and then spread so the same type never lands twice in a
row; goals, services, angles, tone and CTA placement rotate; and the image
template alternates within a content type.

### Duplicate prevention

`contentUniquenessService` scores every candidate against both the current batch
and the user's recent history, across independent axes:

| Group | Axes | Behaviour |
| --- | --- | --- |
| **Strong** | caption trigrams, headline, opening line | Any one alone can fail a post — an identical headline must not hide behind five fresh axes |
| **Soft** | topic (type+goal+service), hashtags, CTA | Reuse that is often *correct*; these only add up, and no single one can flag a post |

A business is *supposed* to reuse its CTA and hashtags — flagging that would
train users to ignore warnings. So soft signals only warn in combination, and
the note names the **biggest contributor first**.

Scores at/above `REGENERATE` (0.62) are regenerated automatically (up to 2
attempts); if still repetitive, the **freshest** attempt is kept and the card is
flagged for review rather than silently shipped. Scores at/above `WARN` (0.45)
are flagged. Only derived token sets are persisted — never the caption text.

### Template selection by content type

| Content type | Template |
| --- | --- |
| `tips` | Checklist Tips (renders numbered bullets) |
| `proof` | Stat Proof (one large figure) |
| `comparison` | Split Comparison (two columns) |
| `authority` / `educational` | Clean Editorial Premium |
| `cta` | Geometric Conversion Post |
| `promotional` | Bold Service Promo |
| `local` | Local Business Authority |

Each has an alternate so consecutive posts of the same type differ visually.
When a layout's structured data is missing, it falls back to a plain card rather
than rendering an empty frame.

**On invented facts:** a `proof` post asks the model for a figure that appears
in the brief and to return an **empty string** when the brief states none. No
statistic, price, or guarantee is fabricated to fill a template.

### Editing and regeneration

Every field a human touches is recorded in `editedFields`, and regeneration
refuses to overwrite those fields — "regenerate the image" never discards a
rewritten caption. Regenerating a caption *does* require an explicit `force`
when the caption was edited, and says so. Only fields whose values **actually
changed** are marked as edited, because the drawer submits the whole form.

### Queue integration

Approving and queueing creates the same `scheduled_posts` rows the manual flow
creates, with targets, captions and the rendered image, marked `queued` for a
future publishing phase. **Nothing in the planner calls a provider endpoint.**
Deleting a plan never deletes posts it already queued (`post_id` is
`ON DELETE SET NULL`).

### Autopilot: prepared, not live

`autopilot_enabled` and `next_plan_generation_at` are stored so a scheduler can
be wired up later without another migration. **No job reads them today**, and
autopilot would only ever trigger *generation* — never publishing. The UI says
so.

### Migration

`database/migrations/007_auto_content_planner.sql` — additive only. Adds
`planner_preferences`, `planner_runs`, `planner_run_items`. Existing tables are
untouched.

## Phase 4.6 — premium branded post design

### How the templates are organised

```
src/templates/
├── brandKit.js               # the design system: palette, fonts, type scale, validation
├── baseStyles.js             # shared stylesheet (type roles, CTA, footer, shapes)
├── parts.js                  # shared HTML fragments (logo, CTA, footer lockup, tag)
├── socialImageTemplates.js   # orchestrator: validate → derive → render
└── layouts/                  # one module per template + a registry
```

Adding a template means adding a module under `layouts/` and its slug to
`IMAGE_TEMPLATES` — nothing else in the pipeline changes.

### The seven layouts

Each is a distinct composition built from the same business data, so they read
as one system rather than seven unrelated designs. Square (1080×1080) is the
reference canvas; portrait and landscape scale the type from it.

| Template | Composition |
| --- | --- |
| `editorial-premium` | Clean Editorial Premium — full-height brand rule, asymmetric editorial column, logo top-right |
| `bold-service-promo` | Bold Service Promo — full-bleed brand field cut by a diagonal, oversized uppercase headline |
| `local-authority` | Local Business Authority — framed card, corner ribbon, service badge, footer rule |
| `modern-split` | Modern Split Layout — 40/60 vertical split, layered arcs on the brand panel |
| `minimal-luxury` | Minimal Luxury Card — double frame, centred type, hairline ornament, outlined CTA |
| `geometric-conversion` | Geometric Conversion Post — arcs sweeping into a high-contrast CTA |
| `photo-overlay` | Photo Overlay Ready — a real background-image slot + scrim |

The picker is built from `GET /api/posts/capabilities` (`templates: [{id, label}]`),
so the UI can never drift from the layouts the renderer actually has.

**Backwards compatible.** Every earlier name still renders, so drafts saved
before this phase keep working: `editorial`, `bold-service`, `professional-local`
(Phase 4.5b) and `minimal`, `bold`, `professional` (Phase 4) all map onto a
current layout.

### The brand kit

Business brand colours are arbitrary user input, so they are never used raw:

- **Normalized, not rejected.** Saturation and lightness are clamped into a band
  that can carry large filled areas. A neon `#00ff00` keeps its hue but loses the
  glare. An achromatic brand (`#ffffff`, grey) stays achromatic and darkens into
  a charcoal — forcing a minimum saturation would invent a hue and render a white
  brand brown.
- **Tinted neutrals.** Surfaces and text carry a trace of the brand hue instead
  of being flat grey; nothing is `#fff` or `#000`. That shared tint is what makes
  the set cohere.
- **Guaranteed legible fills.** A fill that leaves neither near-black nor white
  readable is nudged in lightness until it passes WCAG AA (4.5:1) — e.g. a
  `#ff0088` accent CTA would otherwise ship at 3.98:1.
- **Hierarchy, not equality.** Primary drives major accents, secondary supports,
  accent is reserved for small marks (CTA, rules, dots).

Typography maps a brand **font label** to a style category (serif / sans / mono /
condensed) and renders the closest system stack — no font file is ever
downloaded, and a serif brand still looks like a serif brand. The headline size,
leading, and tracking are chosen from the headline's own character count, so
short headlines are set large and long ones stay balanced instead of overflowing.

### Optional modules

Included only when supplied, and omitted cleanly rather than rendered empty:
logo, website, phone, CTA, eyebrow (brand name, falling back to category),
service tag, and the footer lockup. Per-post toggles: `includeLogo` (default on),
`includeWebsite` (default on, rendered as a bare host), `includePhone` (default
off). A headline on its own still produces a complete design.

### Security

Unchanged from Phase 4.5b, and asserted per template:

- Colours must match `#rrggbb`; font labels must match `/^[A-Za-z0-9 _-]{1,80}$/`;
  the logo must be absolute **https** — otherwise a safe default is used and, for
  a logo, no `<img>` is emitted at all.
- All user text is HTML-escaped, then the generated HTML is re-sanitized with a
  strict allow-list. The allow-list includes the inert sectioning elements the
  layouts are built from (`header`/`footer`/`aside`/`section`) — a test asserts
  each layout survives sanitization element-for-element, because a discarded tag
  would silently flatten a design rather than raise an error.
- **No `url()` is ever written to CSS**, so a render cannot fetch a stock photo,
  font, or tracker. The business's own validated https logo is the only remote
  asset, and it is an `<img>`.
- **No photos are invented.** Visual interest is CSS geometry. `photo-overlay`
  keeps a dedicated `.photo-slot` for a future image provider; until then it
  renders a brand-tinted gradient.

## Phase 4.5a — business onboarding & website brand extraction

Each user gets **one business profile** (`business_profiles`, UNIQUE `user_id`)
holding their reviewed business identity, brand, contacts, and onboarding state.

### Onboarding flow

`not_started → business_source → analyzing → brand_review → connections → completed`

New users are prompted to set up their business (analyze a website, or enter
details manually), review/edit the extracted brand, then connect social
accounts. **Existing users are never locked out** — a user with no profile row
reads as `not_started` with `canUseApp: true`, keeps full access to every
existing feature, and simply sees a "complete business setup" prompt.

### Website analysis

Explicit, user-triggered only (never on page load/refresh). It fetches **at most
4 pages** — homepage plus one likely About / Services / Contact page — restricted
to the **same registrable domain**, skipping private/state-changing paths
(`/login`, `/admin`, `/account`, `/checkout`, `/cart`, `/logout`, …). It returns
**editable suggestions**; nothing is saved until the user reviews them.

### SSRF protections

The analyzer fetches attacker-influenceable URLs, so every hop is validated:

- **http/https only**; **HTTPS required in production** (plain HTTP is allowed
  only outside production and reported as an `insecure_http` warning).
- Embedded credentials rejected; query strings and fragments stripped.
- **DNS resolved before each request**; the host is rejected if **any** resolved
  address is loopback/private/link-local/CGNAT/multicast/metadata — IPv4 **and**
  IPv6 (including IPv4-mapped `::ffff:10.0.0.1` and `169.254.169.254`).
- Internal hostnames blocked (`localhost`, `*.local`, `*.internal`, bare names).
- **Redirects followed manually and re-validated on every hop** (max 3) — a
  redirect to a private IP or internal host is refused and never fetched.
- Request timeout, **response byte cap**, and **HTML-only** content types
  (PDFs/images/downloads rejected).
- **No auth headers, no cookies, no JavaScript execution, no headless browser,
  no form submission.** Raw page HTML is never returned, stored, or logged, and
  internal fetch/DNS errors are never surfaced.

> **Known limitation (documented, not hidden):** addresses are validated before
> connecting, so a hostile authoritative DNS server could theoretically flip a
> record between our check and the socket connect (DNS-rebinding TOCTOU).
> Closing it fully requires pinning the connection to the validated IP with a
> custom agent — a candidate hardening step, not something implied as done.

### Brand extraction (best-effort suggestions)

- **Logo priority:** JSON-LD `logo` → header image → `logo`-ish class/id/alt →
  OG image *only when it looks like a logo* → favicon fallback. Not every large
  image is treated as a logo. A logo is **only fetched from the analyzed site's
  own domain**; off-site/CDN logos are offered as an editable suggestion but
  never fetched. SVGs containing scripts, handlers, `<use>`, `<foreignObject>`,
  or external references are **rejected outright** (never "sanitized and hoped").
- **Colors:** frequency-ranked CSS colors with CSS custom properties weighted
  highest; white/near-white, black, and low-saturation utility greys are filtered
  out; results validated as hex and fully editable.
- **Fonts:** detected from CSS variables and body/heading rules; only plain font
  **names** are returned (no font files are downloaded or redistributed).
- **Contacts/identity:** JSON-LD (`LocalBusiness`/`Organization`), Open Graph,
  `tel:`/`mailto:` links, then bounded text fallbacks.
- **Services:** concise, deduplicated names with count/length caps — never a
  full-page text dump.

Extraction is heuristic; every field is a suggestion the user reviews.

### OpenAI normalization (optional)

If configured, OpenAI may normalize **already-extracted plain text** into a
concise description/services/category/tone. It receives **no page HTML, no
emails, no phone numbers, no secrets**. Analysis works fully without OpenAI, and
an OpenAI failure never blocks manual editing.

### Manual edits win

Every field a user edits by hand is recorded. Later automatic suggestions
**never silently overwrite** it — `apply-extracted` returns `preservedFields`
listing what it declined to change.

### Business profile API (auth; state-changing = CSRF)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/business-profile` | sanitized profile (no internal diagnostics) |
| GET | `/api/business-profile/onboarding-state` | drives the onboarding redirect |
| PUT | `/api/business-profile` | whitelisted fields; unknown fields **rejected** |
| POST | `/api/business-profile/analyze-website` | strict rate limit (10/hr) |
| POST | `/api/business-profile/apply-extracted` | preserves manual edits |
| POST | `/api/business-profile/complete-onboarding` | marks onboarding complete |
| DELETE | `/api/business-profile` | removes the profile only |

There is **no arbitrary asset-fetch endpoint** — website analysis is the only
outbound action, and it is always user-triggered.

### Migration 006

Apply [`006_business_onboarding.sql`](database/migrations/006_business_onboarding.sql)
to an existing database (additive only — creates `business_profiles`, touches no
existing data). Fresh installs get it from `schema.sql`. **No new environment
variables**; analyzer limits are fixed constants.

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

**Request format (GPT-5 compatible).** Generation uses the **Responses API**
(`responses.create`) with **strict JSON Schema Structured Outputs** — the schema
dynamically requires only the selected platform keys plus `visual`, with
`additionalProperties: false` throughout. GPT-5-series models are reasoning
models, so the request sends `max_output_tokens` and `reasoning: { effort:
'minimal' }` and sends **no `temperature` and no `max_tokens`** (both are
rejected with a 400). Because effort support is model-dependent, a 400 naming
the reasoning parameter transparently retries once without it.

> **Token budgeting:** reasoning tokens are billed against `max_output_tokens`.
> If generation returns `incomplete_output` ("content was cut short"), raise
> **`OPENAI_MAX_OUTPUT_TOKENS`** — the default of `1200` can be tight when
> generating for all three platforms at once.

Failures are classified distinctly — `invalid_request` (a 400: we sent something
the model rejected), `incomplete_output` (truncated), `content_refused`,
`authentication_failed`, `rate_limited`, `quota_exceeded`, `timeout`,
`provider_unavailable`, `invalid_provider_response` — and runtime diagnostics log
**only** the upstream HTTP status, a safe OpenAI error code, and the internal
classification (never prompts, captions, request bodies, upstream messages, or
keys).

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
│   ├── app.html              # Single shell for every application route
│   ├── 404.html
│   └── assets/
│       ├── css/              # design-system.css (tokens + components)
│       └── js/               # main, router, nav, api, ui, icons
│           ├── components/   # brandForm, providerCards
│           └── pages/        # one module per route
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
│   ├── templates/            # brandKit, baseStyles, parts, layouts/ (trusted HTML/CSS)
│   ├── (planner)             # services: plannerService, plannerBriefService,
│   │                         #   plannerScheduleService, contentUniquenessService
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
