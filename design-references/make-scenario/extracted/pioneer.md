# Make.com scenario extraction — Pioneer Construction Daily Content Generator

Reference capture for code migration. Everything below is verbatim from the Make
blueprint except values replaced with the literal token `[REDACTED]`.

**Redacted:** connection ids and all `__IMTCONN__` values, team/user ids, the
Facebook page id, the LinkedIn organization urn, sample post/share ids, the
generated HCTI image id + URL, and **every email address** (including the
business contact email, which appears three times: twice in the system prompt
and once inside the `tpl_project` footer markup — a real email literal sits at
each `[REDACTED]` marker there).

---

## 1. Scenario

| Field | Value |
| --- | --- |
| Name | `Pioneer Construction - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9261788` |
| Team id | `[REDACTED]` |
| Created | 2026-05-19T20:34:36.066Z |
| Last edit | 2026-05-25T09:28:07.954Z |
| Active | `true` |
| Created / updated by | Sajid Imran, `[REDACTED]` |
| Folder | none |
| Hook | none (no webhook) |
| Description | *(empty)* |
| Concept / paused / locked / invalid | all `false` |

Packages used: `builtin`, `util` (x3), `openai-gpt-3`, `html-css-to-image` (x2),
`facebook-pages`, `linkedin`.

### Scheduling

```json
{
  "type": "indefinitely",
  "interval": 900,
  "restrict": [
    {
      "days": [1, 2, 3, 4, 5, 6, 0],
      "time": ["14:00", "14:01"]
    }
  ]
}
```

Polls every 900 s (15 min) but is restricted to a one-minute window, **14:00–14:01
every day of the week** (`days` lists all seven). Effectively "once daily at 14:00
team-local". `nextExec` was `2026-07-20T09:00:00.000Z`, i.e. the team timezone is
UTC+5.

### Scenario runtime settings

```json
{
  "dlq": false,
  "slots": null,
  "dataloss": false,
  "maxErrors": 3,
  "autoCommit": true,
  "roundtrips": 1,
  "sequential": false,
  "confidential": false,
  "freshVariables": false,
  "autoCommitTriggerLast": true
}
```

`interface`: `{"input": [], "output": []}` — no scenario inputs or outputs.

### Module flow (linear, 9 modules, no branches)

| # | Module | Role |
| --- | --- | --- |
| 1 | `builtin:BasicFeeder` | fires one bundle to start the run |
| 2 | `util:SetVariables` | day rhythm (`day_of_week`, `content_type`, `image_template`) |
| 3 | `openai-gpt-3:CreateCompletion` | single LLM call, all copy + all image data |
| 4 | `util:SetVariables` | 7 HTML templates + 1 shared CSS blob |
| 5 | `util:SetVariable2` | picks `final_html` by template name |
| 6 | `html-css-to-image:Image` | renders 1080×1080 |
| 7 | `html-css-to-image:GetImage` | fetches PNG binary |
| 8 | `facebook-pages:UploadPhoto` | publishes photo + caption |
| 9 | `linkedin:CreateCompanyImagePost` | publishes company image post |

---

## 2. Filters, routers, error handlers, history lookups

**There are none.** Explicitly verified across the whole blueprint:

- No `filter` key on any of the 9 modules — every module runs unconditionally.
- No router module (`builtin:BasicRouter`) — the flow is a straight line, no
  branching, no per-platform routes.
- No error handler directives (`onerror`) on any module, and no
  `builtin:Ignore` / `builtin:Break` / `builtin:Resume` / `builtin:Rollback`
  / `builtin:Commit` handlers anywhere. Failures rely purely on the scenario-level
  `maxErrors: 3`.
- No sleep, no aggregator, no iterator, no repeater beyond the single
  `BasicFeeder`.
- **No history / recent-post / dedupe lookup of any kind.** There is no Google
  Sheets module, no data store module, no HTTP lookup, no `Search Rows`, no
  `Get a record`. Nothing reads what was posted before, and nothing writes a log
  after posting. Uniqueness relies entirely on `temperature: 0.85`. Consequently
  there are no Google Sheet ids or datastore ids present in this scenario at all.

---

## 3. Module 1 — `builtin:BasicFeeder` (trigger)

```json
{
  "id": 1,
  "module": "builtin:BasicFeeder",
  "version": 1,
  "mapper": { "array": "[{\"trigger\":\"start\"}]" },
  "parameters": {},
  "metadata": { "designer": { "x": 0, "y": 0 } }
}
```

A static one-element array — a scheduler-only kick, no external trigger data.

---

## 4. Module 2 — `util:SetVariables` (the day rhythm)

`scope: "roundtrip"`. Three variables, full values:

### `day_of_week`

```
{{formatDate(now; "dddd")}}
```

### `content_type`

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_spotlight"; "Tuesday"; "trust_stat"; "Wednesday"; "nyc_code_tip"; "Thursday"; "project_showcase"; "Friday"; "customer_testimonial"; "Saturday"; "pro_tip_warning"; "Sunday"; "brand_insight")}}
```

### `image_template`

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_card"; "Tuesday"; "stat_card"; "Wednesday"; "cheatsheet"; "Thursday"; "project_card"; "Friday"; "testimonial"; "Saturday"; "warning_card"; "Sunday"; "quote_card")}}
```

### Resolved rhythm table

| Day | `content_type` | `image_template` |
| --- | --- | --- |
| Monday | `service_spotlight` | `service_card` |
| Tuesday | `trust_stat` | `stat_card` |
| Wednesday | `nyc_code_tip` | `cheatsheet` |
| Thursday | `project_showcase` | `project_card` |
| Friday | `customer_testimonial` | `testimonial` |
| Saturday | `pro_tip_warning` | `warning_card` |
| Sunday | `brand_insight` | `quote_card` |

Note both switches are **defaultless** — an unmatched day yields an empty string.
There is no fallback template.

---

## 5. Module 3 — `openai-gpt-3:CreateCompletion`

| Setting | Value |
| --- | --- |
| `select` | `chat` (Create a Chat Completion, GPT and o1 models) |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `2500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| Connection | `__IMTCONN__`: `[REDACTED]` (label: "Pioneer OpenAI") |

Two messages: one `system`, one `user`. Both verbatim below, untruncated.

### System prompt (verbatim)

```text
You are the Marketing Lead for Pioneer Construction NYC — a licensed and insured general construction company in New York City serving all 5 boroughs since 1994.

## BUSINESS DETAILS:
- Established: 1994 (30+ years experience)
- Address: 299 Fordham Place FL 2, Bronx, NY 10464
- Phone: (347) 577-2852
- Email: [REDACTED]
- Website: https://pioneerconstructionnyc.com/
- Service Areas: Manhattan, Brooklyn, Queens, Bronx, Staten Island
- Licensed, OSHA-compliant, bonded, insured

## 8 CORE SERVICES:
1. Brick Pointing & Masonry (brownstones, townhouses)
2. Concrete Services & Sidewalk Repairs (DOT violations, driveways)
3. Stucco & Siding (residential and commercial)
4. Roofing & Waterproofing (flat roofs, full replacements)
5. Scaffolding & Sidewalk Sheds (NYC-approved, DOB compliant)
6. Brownstone Restoration (historic NYC homes)
7. Fire Escapes & Parapet Wall Repairs
8. Demolition & Junk Removal

## CORE RULES:
1. First-person as Pioneer Construction NYC ('We've handled', 'Our crew')
2. End EVERY post with contact info: phone, email, website
3. Be specific to NYC (mention boroughs, NYC codes, DOB, DOT)
4. Specific tactics, numbers, real construction insights
5. Rotate across services - don't focus on one
6. NO double quotes inside text values

## TONE RULES (CRITICAL):
- NO EMOJIS in post text
- No fancy symbols
- Plain numbered lists (1. 2. 3.)
- Clean professional construction industry voice
- Sound trustworthy, experienced, no-nonsense

## FORMATTING (CRITICAL):
- \n\n between EVERY paragraph and EVERY list item
- Each paragraph: 1-3 short sentences max

### Example structure:
Most NYC sidewalk violations come with a 75-day deadline.

We handle DOT violation removals across all 5 boroughs.

Here is what NYC property owners need to know:

1. Inspect your sidewalk twice a year for cracks.

2. Get permits before any repair work begins.

3. Use 4-inch concrete minimum as NYC code requires.

4. Hire licensed contractors only.

5. Document everything for insurance.

We have been doing this since 1994.

Phone: (347) 577-2852

Email: [REDACTED]

Website: https://pioneerconstructionnyc.com/

#NYCConstruction #SidewalkRepair #BronxContractor #BrooklynConstruction #Manhattan

CONTENT TYPE TODAY: {{2.content_type}}
IMAGE TEMPLATE TODAY: {{2.image_template}}

## IMAGE DATA REQUIREMENTS (KEEP TEXT SHORT - it's a poster):

### service_card (Monday):
- service_name (e.g. 'Brick Pointing', max 3 words)
- service_subtitle (e.g. 'and Masonry Work', max 4 words)
- problem_text (max 8 words)
- solution_text (max 8 words)
- result_text (max 8 words)
- tags (3 short tags max 2 words each)

### stat_card (Tuesday):
- big_stat (e.g. '30+', '5', '1994' - max 4 chars)
- stat_label (max 12 words)
- overline (1-2 words)
- badges (3 short badges max 1 word each)

### cheatsheet (Wednesday):
- title_line1 (max 5 words)
- title_line2 (max 3 words, highlighted red)
- category_tag (max 3 words)
- tips (5 main tips, max 4 words each)
- tip_subtitles (5 subtitles, max 7 words each)

### project_card (Thursday):
- project_type (max 3 words)
- project_location (max 3 words)
- detail_1 (max 5 words)
- detail_2 (max 5 words)
- detail_3 (max 5 words)
- timeline (max 3 words)
- result_highlight (max 5 words)

### testimonial (Friday):
- review_quote (max 18 words, customer's voice)
- review_subtitle (max 12 words)
- client_name (max 3 words)
- client_location (max 3 words)
- client_initials (2 letters)

### warning_card (Saturday):
- warning_title (max 5 words)
- highlight_word (1-2 words, red)
- mistake_description (max 12 words)
- consequence (max 10 words)
- solution_text_warning (max 12 words)
- pro_tip (max 12 words)

### quote_card (Sunday):
- quote_part1 (first half, max 5 words)
- quote_part2 (second half, max 5 words, red highlight)
- subquote (max 15 words context)
- category_tag (max 3 words)

OUTPUT (JSON only):
{
  "topic": "3-5 word topic",
  "service_focus": "...",
  "hook": "opening hook",
  "facebook_post": "180-280 words. NO EMOJIS. \\n\\n between paragraphs. Include phone, email, website. End with 4-5 NYC hashtags.",
  "linkedin_post": "250-350 words. NO EMOJIS. \\n\\n between paragraphs. Professional B2B tone. Include phone, email, website. End with 5-7 hashtags.",
  "image_data": {
    "service_name": "...",
    "service_subtitle": "...",
    "problem_text": "...",
    "solution_text": "...",
    "result_text": "...",
    "tags": ["3 tags"],
    "big_stat": "...",
    "stat_label": "...",
    "overline": "...",
    "badges": ["3 badges"],
    "title_line1": "...",
    "title_line2": "...",
    "category_tag": "...",
    "tips": ["5 tips"],
    "tip_subtitles": ["5 subtitles"],
    "project_type": "...",
    "project_location": "...",
    "detail_1": "...",
    "detail_2": "...",
    "detail_3": "...",
    "timeline": "...",
    "result_highlight": "...",
    "review_quote": "...",
    "review_subtitle": "...",
    "client_name": "...",
    "client_location": "...",
    "client_initials": "...",
    "warning_title": "...",
    "highlight_word": "...",
    "mistake_description": "...",
    "consequence": "...",
    "solution_text_warning": "...",
    "pro_tip": "...",
    "quote_part1": "...",
    "quote_part2": "...",
    "subquote": "..."
  }
}

Only fill image_data fields matching today's template.
```

Transcription note: in the FORMATTING section the prompt contains a single-escaped
`\n\n` literal; inside the OUTPUT JSON block it contains a double-escaped `\\n\\n`
literal. Both are reproduced exactly as stored.

### User prompt (verbatim)

```text
Today is {{2.day_of_week}}. Content type: {{2.content_type}}. Image template: {{2.image_template}}.

Write a fresh post about Pioneer Construction NYC. Make it feel local, NYC-specific, and authentic.

For image_data: KEEP TEXT VERY SHORT. The image is a poster.

Generate JSON now.
```

### Demanded JSON output schema, with per-field constraints

Top level (5 keys):

| Field | Constraint as stated |
| --- | --- |
| `topic` | 3-5 word topic |
| `service_focus` | free text (one of the 8 core services in practice) |
| `hook` | opening hook |
| `facebook_post` | 180-280 words. NO EMOJIS. `\n\n` between paragraphs. Include phone, email, website. End with 4-5 NYC hashtags. |
| `linkedin_post` | 250-350 words. NO EMOJIS. `\n\n` between paragraphs. Professional B2B tone. Include phone, email, website. End with 5-7 hashtags. |
| `image_data` | object, 36 keys — a flat union of all 7 templates' fields |

`image_data` per-template constraints (from the IMAGE DATA REQUIREMENTS section):

**service_card** — `service_name` max 3 words · `service_subtitle` max 4 words ·
`problem_text` max 8 words · `solution_text` max 8 words · `result_text` max 8
words · `tags` 3 tags, max 2 words each.

**stat_card** — `big_stat` max 4 chars · `stat_label` max 12 words · `overline`
1-2 words · `badges` 3 badges, max 1 word each.

**cheatsheet** — `title_line1` max 5 words · `title_line2` max 3 words
(highlighted red) · `category_tag` max 3 words · `tips` 5 items, max 4 words each
· `tip_subtitles` 5 items, max 7 words each.

**project_card** — `project_type` max 3 words · `project_location` max 3 words ·
`detail_1`/`detail_2`/`detail_3` max 5 words each · `timeline` max 3 words ·
`result_highlight` max 5 words.

**testimonial** — `review_quote` max 18 words, customer's voice ·
`review_subtitle` max 12 words · `client_name` max 3 words · `client_location`
max 3 words · `client_initials` 2 letters.

**warning_card** — `warning_title` max 5 words · `highlight_word` 1-2 words (red)
· `mistake_description` max 12 words · `consequence` max 10 words ·
`solution_text_warning` max 12 words · `pro_tip` max 12 words.

**quote_card** — `quote_part1` first half, max 5 words · `quote_part2` second
half, max 5 words (red highlight) · `subquote` max 15 words context ·
`category_tag` max 3 words.

Closing instruction: *"Only fill image_data fields matching today's template."*
The model returns one flat `image_data` object with only the day's subset
populated; the other keys are simply absent (confirmed by the stored sample,
where a Monday run returned only the six `service_card` keys).

### Stored sample output (module 3)

Model resolved to `gpt-4o-mini-2024-07-18`; usage 1510 prompt + 653 completion =
2163 tokens; `finish_reason: stop`. Sample `result`:

```json
{
  "hook": "Preserving the beauty of NYC homes is our specialty.",
  "topic": "Expert Brick Pointing Services",
  "service_focus": "Brick Pointing & Masonry",
  "image_data": {
    "tags": ["Masonry"],
    "result_text": "Preserve your home's beauty",
    "problem_text": "Cracks and moisture issues",
    "service_name": "Brick Pointing",
    "solution_text": "Expert brick pointing services",
    "service_subtitle": "and Masonry Work"
  }
}
```

Worth noting for migration: the sample shows `tags` came back with **one**
element although the prompt demands three — which is exactly what the `ifempty()`
fallbacks in the templates exist to absorb.

---

## 6. Module 4 — `util:SetVariables` (7 templates + shared CSS)

`scope: "roundtrip"`. Eight variables. All values verbatim below. Each template is
stored as a single-line HTML string; the line breaks you see are only in this
document's fences where the source had none — each block below is one unbroken
line in the blueprint.

### `tpl_service` (Monday — service_card)

```html
<div class='card dark-card'><div class='red-top-bar'></div><div class='grid-bg'></div><div class='red-orb'></div><div class='header'><div class='logo-group'><div class='logo-skew'><span class='logo-letter'>P</span></div><span class='brand-text'>PIONEER CONSTRUCTION</span></div><div class='badge-red-border'>★ SERVICE</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>EXPERT WORK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.service_name; "")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.service_subtitle; "")}}</span></h1></div><div class='service-blocks'><div class='block-left-red'><div class='block-label'>THE PROBLEM</div><div class='block-text'>{{ifempty(3.result.image_data.problem_text; "")}}</div></div><div class='block-left-red'><div class='block-label'>OUR SOLUTION</div><div class='block-text'>{{ifempty(3.result.image_data.solution_text; "")}}</div></div><div class='block-left-red'><div class='block-label'>THE RESULT</div><div class='block-text'>{{ifempty(3.result.image_data.result_text; "")}}</div></div><div class='tag-row'><div class='tag-red'>● {{ifempty(get(3.result.image_data.tags; 1); "Brownstones")}}</div><div class='tag-red'>● {{ifempty(get(3.result.image_data.tags; 2); "Townhouses")}}</div><div class='tag-red'>● {{ifempty(get(3.result.image_data.tags; 3); "Commercial")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Serving all 5 NYC boroughs</span><span class='footer-red-strong'>(347) 577-2852</span></div></div>
```

### `tpl_stat` (Tuesday — stat_card)

```html
<div class='card dark-card'><div class='red-top-bar'></div><div class='grid-bg'></div><div class='red-orb-top'></div><div class='header'><div class='logo-group'><div class='logo-skew'><span class='logo-letter'>P</span></div><span class='brand-text'>PIONEER CONSTRUCTION</span></div><div class='badge-red-border'>SINCE 1994</div></div><div class='stat-body'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>{{ifempty(3.result.image_data.overline; "TRUST FACTOR")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.big_stat; "30")}}<span class='red-plus'>+</span></div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "")}}</div><div class='badge-row'><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 1); "LICENSED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 2); "INSURED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 3); "OSHA")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>(347) 577-2852</span><span class='footer-red-strong'>pioneerconstructionnyc.com →</span></div></div>
```

### `tpl_cheat` (Wednesday — cheatsheet)

```html
<div class='card light-card'><div class='red-top-bar'></div><div class='light-orb'></div><div class='header light-header-style'><div class='logo-group'><div class='logo-skew-dark'><span class='logo-letter-red'>P</span></div><span class='brand-text-dark'>PIONEER CONSTRUCTION</span></div><div class='badge-red-solid'>▲ {{ifempty(3.result.image_data.category_tag; "NYC PRO TIPS")}}</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red-light'>NYC BUILDING CODE</span></div><h1 class='cheat-title-dark'>{{ifempty(3.result.image_data.title_line1; "")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.title_line2; "")}}</span></h1></div><div class='tip-list-light'><div class='tip-card-light'><div class='tip-num-black'>01</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 1); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>02</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 2); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>03</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 3); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>04</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 4); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>05</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 5); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "")}}</span></div></div></div><div class='card-footer light-footer-style'><span class='footer-gray'>Call (347) 577-2852</span><span class='footer-red-strong'>pioneerconstructionnyc.com →</span></div></div>
```

### `tpl_project` (Thursday — project_card)

The footer of this template contains the business email literal in the source; it
is shown here as `[REDACTED]`.

```html
<div class='card dark-card'><div class='red-top-bar'></div><div class='grid-bg'></div><div class='red-orb'></div><div class='header'><div class='logo-group'><div class='logo-skew'><span class='logo-letter'>P</span></div><span class='brand-text'>PIONEER CONSTRUCTION</span></div><div class='badge-red-border'>◆ PROJECT</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>RECENT WORK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.project_type; "")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.project_location; "")}}</span></h1></div><div class='project-details'><div class='detail-row'><div class='detail-icon-red'>01</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_1; "")}}</div></div><div class='detail-row'><div class='detail-icon-red'>02</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_2; "")}}</div></div><div class='detail-row'><div class='detail-icon-red'>03</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_3; "")}}</div></div><div class='project-stats'><div class='stat-block'><div class='stat-block-label'>TIMELINE</div><div class='stat-block-value'>{{ifempty(3.result.image_data.timeline; "")}}</div></div><div class='stat-block-divider'></div><div class='stat-block'><div class='stat-block-label'>RESULT</div><div class='stat-block-value'>{{ifempty(3.result.image_data.result_highlight; "")}}</div></div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>[REDACTED]</span><span class='footer-red-strong'>(347) 577-2852</span></div></div>
```

### `tpl_testimonial` (Friday — testimonial)

```html
<div class='card red-card'><div class='grid-bg-light'></div><div class='quote-deco-bg'>&ldquo;</div><div class='dark-orb-bottom'></div><div class='header'><div class='logo-group'><div class='logo-skew-white'><span class='logo-letter-red'>P</span></div><span class='brand-text'>PIONEER CONSTRUCTION</span></div><div class='badge-glass'>★ 5-STAR REVIEW</div></div><div class='quote-body'><div class='stars-row'><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span></div><div class='testimonial-text'>{{ifempty(3.result.image_data.review_quote; "")}}</div><div class='testimonial-sub'>{{ifempty(3.result.image_data.review_subtitle; "")}}</div></div><div class='card-footer red-card-footer'><div class='author-block'><div class='author-circle'>{{ifempty(3.result.image_data.client_initials; "CD")}}</div><div class='author-info'><div class='author-name'>{{ifempty(3.result.image_data.client_name; "")}}</div><div class='author-role'>{{ifempty(3.result.image_data.client_location; "")}}</div></div></div><span class='url-light'>pioneerconstructionnyc.com</span></div></div>
```

### `tpl_warning` (Saturday — warning_card)

```html
<div class='card dark-card'><div class='red-top-bar-thick'></div><div class='grid-bg'></div><div class='red-orb'></div><div class='header'><div class='logo-group'><div class='logo-skew'><span class='logo-letter'>P</span></div><span class='brand-text'>PIONEER CONSTRUCTION</span></div><div class='badge-warning'>⚠ WARNING</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>COMMON MISTAKE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.warning_title; "")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.highlight_word; "")}}</span></h1></div><div class='warning-blocks'><div class='warn-block'><div class='warn-label-red'>THE MISTAKE</div><div class='warn-text'>{{ifempty(3.result.image_data.mistake_description; "")}}</div></div><div class='warn-block consequence-block'><div class='warn-label-red'>CONSEQUENCE</div><div class='warn-text'>{{ifempty(3.result.image_data.consequence; "")}}</div></div><div class='warn-block solution-block'><div class='warn-label-green'>DO THIS INSTEAD</div><div class='warn-text-white'>{{ifempty(3.result.image_data.solution_text_warning; "")}}</div></div><div class='pro-tip-bar'><span class='pro-tip-label'>PRO TIP:</span> {{ifempty(3.result.image_data.pro_tip; "")}}</div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Avoid costly mistakes</span><span class='footer-red-strong'>(347) 577-2852</span></div></div>
```

### `tpl_quote` (Sunday — quote_card)

```html
<div class='card black-quote-card'><div class='grid-bg'></div><div class='red-side-bar'></div><div class='red-orb-large'></div><div class='header'><div class='logo-group'><div class='logo-skew'><span class='logo-letter'>P</span></div><span class='brand-text'>PIONEER CONSTRUCTION</span></div><div class='badge-red-border'>✦ {{ifempty(3.result.image_data.category_tag; "PIONEER PHILOSOPHY")}}</div></div><div class='quote-block-center'><div class='red-accent-bar'></div><div class='overline-red-quote'>OUR APPROACH</div><div class='quote-mega-text'>{{ifempty(3.result.image_data.quote_part1; "")}} <span class='red-highlight'>{{ifempty(3.result.image_data.quote_part2; "")}}</span></div><div class='quote-sub-text'>{{ifempty(3.result.image_data.subquote; "")}}</div></div><div class='card-footer dark-footer'><div class='since-block'><div class='since-number'>30+</div><div class='since-text'>YEARS<br>SERVING NYC</div></div><div class='contact-stack'><span class='contact-line'>(347) 577-2852</span><span class='contact-line-red'>pioneerconstructionnyc.com</span></div></div></div>
```

### `shared_css` (one CSS blob for all 7 templates)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.dark-card{background:linear-gradient(135deg,#0A0A0A 0%,#1A1A1A 50%,#0A0A0A 100%);color:white}.light-card{background:#F8F8F8;color:#0A0A0A;gap:32px;justify-content:flex-start}.red-card{background:linear-gradient(135deg,#A8232F 0%,#8B1A26 50%,#6B121C 100%);color:white}.black-quote-card{background:#0A0A0A;color:white;justify-content:center}.red-top-bar{position:absolute;top:0;left:0;width:100%;height:12px;background:#A8232F;z-index:5}.red-top-bar-thick{position:absolute;top:0;left:0;width:100%;height:16px;background:#A8232F;z-index:5}.red-side-bar{position:absolute;top:0;left:0;width:12px;height:100%;background:#A8232F;z-index:5}.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(168,35,47,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(168,35,47,0.07) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.grid-bg-light{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.05) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.red-orb{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(168,35,47,0.25) 0%,transparent 70%);pointer-events:none;z-index:1}.red-orb-top{position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(168,35,47,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.red-orb-large{position:absolute;bottom:-300px;right:-300px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(168,35,47,0.2) 0%,transparent 70%);pointer-events:none;z-index:1}.light-orb{position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:rgba(168,35,47,0.08);pointer-events:none;z-index:1}.dark-orb-bottom{position:absolute;bottom:-300px;left:-300px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.quote-deco-bg{position:absolute;top:60px;right:60px;font-size:500px;line-height:0.6;opacity:0.1;font-family:Georgia,serif;font-weight:900;color:white;pointer-events:none;z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3;padding-top:8px}.light-header-style{padding-bottom:28px;border-bottom:3px solid #E5E5E5}.logo-group{display:flex;align-items:center;gap:16px}.logo-skew{background:#A8232F;padding:14px 22px;transform:skewX(-12deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(168,35,47,0.4)}.logo-letter{font-weight:900;font-size:36px;color:white;letter-spacing:2px;transform:skewX(12deg);display:block}.logo-skew-dark{background:#0A0A0A;padding:14px 22px;transform:skewX(-12deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.25)}.logo-skew-white{background:white;padding:14px 22px;transform:skewX(-12deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.2)}.logo-letter-red{font-weight:900;font-size:36px;color:#A8232F;letter-spacing:2px;transform:skewX(12deg);display:block}.brand-text{font-size:22px;font-weight:900;letter-spacing:4px;color:white}.brand-text-dark{font-size:22px;font-weight:900;letter-spacing:4px;color:#0A0A0A}.badge-red-border{background:rgba(168,35,47,0.15);border:2px solid #A8232F;padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-red-solid{background:#A8232F;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-warning{background:#A8232F;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-glass{background:rgba(0,0,0,0.25);border:2px solid rgba(255,255,255,0.3);padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px;backdrop-filter:blur(10px)}.title-block{position:relative;z-index:3}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}.red-bar{width:36px;height:6px;background:#A8232F}.overline-red{font-size:20px;color:#FF6B7A;font-weight:900;letter-spacing:4px}.overline-red-light{font-size:20px;color:#A8232F;font-weight:900;letter-spacing:4px}.overline-red-quote{font-size:24px;color:#FF6B7A;font-weight:900;letter-spacing:5px;margin-bottom:24px}.service-title{font-size:80px;font-weight:900;color:white;line-height:1.05;letter-spacing:-2.5px}.cheat-title-dark{font-size:80px;font-weight:900;color:#0A0A0A;line-height:1.05;letter-spacing:-2.5px}.red-highlight{color:#A8232F}.service-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.block-left-red{background:rgba(255,255,255,0.05);border-left:6px solid #A8232F;padding:22px 28px}.block-label{font-size:18px;color:#FF6B7A;font-weight:900;letter-spacing:3px;margin-bottom:8px}.block-text{font-size:28px;color:white;font-weight:700;line-height:1.35}.tag-row{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.tag-red{background:rgba(168,35,47,0.18);padding:10px 20px;font-size:18px;color:white;font-weight:700;letter-spacing:0.5px}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.mega-stat{font-size:340px;font-weight:900;color:white;line-height:0.95;letter-spacing:-14px;margin-bottom:16px}.red-plus{color:#A8232F}.stat-desc{font-size:40px;color:#E5E5E5;line-height:1.3;font-weight:500;max-width:900px}.badge-row{display:flex;gap:16px;margin-top:36px;flex-wrap:wrap}.trust-badge{background:rgba(168,35,47,0.15);border-left:6px solid #A8232F;padding:14px 24px;font-size:20px;color:white;font-weight:900;letter-spacing:2px}.tip-list-light{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card-light{background:white;border-left:8px solid #A8232F;padding:20px 26px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)}.tip-num-black{background:#0A0A0A;color:white;min-width:62px;height:62px;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main-dark{font-size:28px;color:#0A0A0A;font-weight:900;line-height:1.25}.tip-sub-dark{font-size:18px;color:#666;font-weight:500;line-height:1.3}.project-details{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.detail-row{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,0.04);border-left:6px solid #A8232F;padding:20px 26px}.detail-icon-red{background:#A8232F;color:white;min-width:56px;height:56px;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center}.detail-text{font-size:26px;color:white;font-weight:600;line-height:1.3}.project-stats{display:flex;align-items:center;gap:32px;margin-top:8px;background:rgba(168,35,47,0.12);border:2px solid rgba(168,35,47,0.4);padding:24px 32px}.stat-block{flex:1}.stat-block-label{font-size:16px;color:#FF6B7A;font-weight:900;letter-spacing:3px;margin-bottom:6px}.stat-block-value{font-size:30px;color:white;font-weight:900;line-height:1.2}.stat-block-divider{width:2px;height:60px;background:rgba(168,35,47,0.4)}.stars-row{display:flex;gap:6px;margin-bottom:20px}.star{color:white;font-size:48px;font-weight:900}.testimonial-text{font-size:54px;font-weight:900;line-height:1.2;letter-spacing:-1.5px;color:white}.testimonial-sub{font-size:24px;opacity:0.9;margin-top:18px;font-weight:500;line-height:1.4}.author-block{display:flex;align-items:center;gap:18px}.author-circle{width:60px;height:60px;border-radius:50%;background:rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white}.author-info{display:flex;flex-direction:column}.author-name{font-size:22px;font-weight:900;color:white}.author-role{font-size:18px;opacity:0.85;color:white;font-weight:500}.warning-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.warn-block{background:rgba(255,255,255,0.05);border-left:6px solid #A8232F;padding:22px 28px}.consequence-block{background:rgba(168,35,47,0.15);border-left:6px solid #A8232F}.solution-block{background:rgba(34,197,94,0.12);border-left:6px solid #22C55E}.warn-label-red{font-size:18px;color:#FF6B7A;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-label-green{font-size:18px;color:#4ADE80;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-text{font-size:26px;color:white;font-weight:700;line-height:1.35}.warn-text-white{font-size:26px;color:white;font-weight:700;line-height:1.35}.pro-tip-bar{background:rgba(168,35,47,0.2);padding:18px 24px;font-size:22px;color:white;font-weight:600;line-height:1.4;border:2px solid rgba(168,35,47,0.5);margin-top:8px}.pro-tip-label{color:#FF6B7A;font-weight:900;letter-spacing:2px;margin-right:8px}.quote-block-center{position:relative;z-index:3;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:880px}.red-accent-bar{height:8px;width:80px;background:#A8232F;margin-bottom:24px}.quote-mega-text{font-size:96px;font-weight:900;line-height:1.05;letter-spacing:-3px;color:white;margin-bottom:28px}.quote-sub-text{font-size:32px;color:#E5E5E5;line-height:1.4;font-weight:500;max-width:780px}.since-block{display:flex;align-items:center;gap:14px}.since-number{font-size:56px;font-weight:900;color:#A8232F;line-height:1}.since-text{font-size:14px;font-weight:900;color:white;letter-spacing:2.5px;line-height:1.3}.contact-stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.contact-line{font-size:22px;color:white;font-weight:700;letter-spacing:1px}.contact-line-red{font-size:18px;color:#FF6B7A;font-weight:700;letter-spacing:0.5px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;position:relative;z-index:3}.dark-footer{border-top:2px solid rgba(168,35,47,0.4)}.light-footer-style{border-top:3px solid #E5E5E5}.red-card-footer{border-top:2px solid rgba(255,255,255,0.3)}.footer-light-text{font-size:20px;color:#B5B5B5;letter-spacing:1px;font-weight:600}.footer-red-strong{font-size:22px;color:#A8232F;font-weight:900;letter-spacing:0.5px}.footer-gray{font-size:20px;color:#666;font-weight:700;letter-spacing:0.5px}.url-light{font-size:20px;color:white;opacity:0.9;letter-spacing:1.5px;font-weight:600}
```

---

## 7. Module 5 — `util:SetVariable2` (template selection)

Variable name `final_html`, `scope: "roundtrip"`, value:

```
{{switch(2.image_template; "service_card"; 4.tpl_service; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "project_card"; 4.tpl_project; "testimonial"; 4.tpl_testimonial; "warning_card"; 4.tpl_warning; "quote_card"; 4.tpl_quote)}}
```

Also defaultless — no fallback template if `image_template` is empty.

---

## 8. Modules 6 & 7 — rendering (`html-css-to-image`)

### Module 6 — `html-css-to-image:Image`

| Parameter | Value |
| --- | --- |
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `google_fonts` | `Inter` |
| `device_scale` | `2` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `ms_delay` | not set |
| `full_screen` | not set |
| `selector` | not set |
| Connection | `__IMTCONN__`: `[REDACTED]` (label: "Pioneer Construction HTML/CSS to Image connection") |

Renders a 1080×1080 canvas at 2× device scale (2160×2160 actual pixels). Only
`Inter` is requested from Google Fonts; `Georgia, serif` is used in
`.quote-deco-bg` and relies on the renderer's system fonts.

### Module 7 — `html-css-to-image:GetImage`

| Parameter | Value |
| --- | --- |
| `image_id` | `{{6.id}}` |
| `format` | `png` (enum: jpg / png / webp) |
| Connection | `__IMTCONN__`: `[REDACTED]` (same connection as module 6) |

Outputs `{{7.image}}` (binary buffer) and `{{7.fileName}}` (`<image_id>.png`).
Stored sample buffer was ~1.6 MB. Sample image id and its `hcti.io` URL:
`[REDACTED]`.

---

## 9. Publishing modules

Two publish targets, run unconditionally and sequentially. **No Instagram,
Threads, Pinterest, X or Google Business module exists in this scenario** despite
the "Multi-Platform" name.

### Module 8 — `facebook-pages:UploadPhoto` (version 6)

| Parameter | Value |
| --- | --- |
| `page_id` | `[REDACTED]` (label: "Pioneer Construction NYC") |
| `fileName` | `{{7.fileName}}` |
| `data` | `{{7.image}}` |
| `message` | `{{3.result.facebook_post}}` |
| Connection | `__IMTCONN__`: `[REDACTED]` (type `account:facebook`, label `[REDACTED]`) |

Single photo upload with the Facebook copy as the caption. Sample returned a photo
id and a `post_id` — both `[REDACTED]`.

### Module 9 — `linkedin:CreateCompanyImagePost` (version 2)

| Parameter | Value |
| --- | --- |
| `organization` | `[REDACTED]` (urn form, label: "Pioneer Construction NYC") |
| `method` | `upload` (Upload by file) |
| `fileName` | `{{7.fileName}}` |
| `data` | `{{7.image}}` |
| `title` | `{{3.result.topic}}` |
| `altText` | `Pioneer Construction NYC project insights` |
| `content` | `{{3.result.linkedin_post}}` |
| `visibility` | `PUBLIC` (Anyone) |
| `feedDistribution` | `MAIN_FEED` |
| `isReshareDisabledByAuthor` | `false` |
| Connection | `__IMTCONN__`: `[REDACTED]` (type `account:linkedin2,linkedin-openid`, label `[REDACTED]`) |

The **same** rendered image goes to both platforms; only the copy differs
(`facebook_post` vs `linkedin_post`). Sample returned a share urn — `[REDACTED]`.

---

## 10. Hardcoded business constants

Collected from the system prompt, the templates and the publish modules.

### Identity

| Constant | Value | Where |
| --- | --- | --- |
| Business name | Pioneer Construction NYC | prompt |
| Brand lockup text | `PIONEER CONSTRUCTION` | all 7 templates |
| Logo mark | letter `P` in a `skewX(-12deg)` red block, text counter-skewed `skewX(12deg)` — **CSS-drawn, no image asset. There is no logo URL anywhere in this scenario.** | all 7 templates |
| Established | 1994 | prompt, `tpl_stat` badge "SINCE 1994" |
| Experience claim | 30+ years | prompt, `tpl_quote` footer `30+` / `YEARS SERVING NYC`, `tpl_stat` default `big_stat` "30" |
| Address | 299 Fordham Place FL 2, Bronx, NY 10464 | prompt only |
| Phone | (347) 577-2852 | prompt (x2) + footers of `tpl_service`, `tpl_stat`, `tpl_cheat`, `tpl_project`, `tpl_warning`, `tpl_quote` |
| Email | `[REDACTED]` | prompt (x2), `tpl_project` footer |
| Website | `https://pioneerconstructionnyc.com/` (prompt) / `pioneerconstructionnyc.com` bare in templates | prompt + `tpl_stat`, `tpl_cheat`, `tpl_testimonial`, `tpl_quote` |
| Credentials | Licensed, OSHA-compliant, bonded, insured | prompt; `tpl_stat` default badges `LICENSED` / `INSURED` / `OSHA` |

### Geography

City: New York City. Service areas: **Manhattan, Brooklyn, Queens, Bronx, Staten
Island** ("all 5 boroughs"). Regulator references baked into the prompt: NYC
building code, DOB, DOT.

### The 8 core services

1. Brick Pointing & Masonry (brownstones, townhouses)
2. Concrete Services & Sidewalk Repairs (DOT violations, driveways)
3. Stucco & Siding (residential and commercial)
4. Roofing & Waterproofing (flat roofs, full replacements)
5. Scaffolding & Sidewalk Sheds (NYC-approved, DOB compliant)
6. Brownstone Restoration (historic NYC homes)
7. Fire Escapes & Parapet Wall Repairs
8. Demolition & Junk Removal

### CTA / contact block

Every post must end with phone, email and website on separate paragraphs (core
rule 2 + the worked example). Template footers carry a fixed CTA pair per
template:

- `tpl_service` — "Serving all 5 NYC boroughs" + phone
- `tpl_stat` — phone + `pioneerconstructionnyc.com →`
- `tpl_cheat` — "Call (347) 577-2852" + `pioneerconstructionnyc.com →`
- `tpl_project` — email `[REDACTED]` + phone
- `tpl_testimonial` — author block + `pioneerconstructionnyc.com`
- `tpl_warning` — "Avoid costly mistakes" + phone
- `tpl_quote` — `30+ YEARS SERVING NYC` + phone + website

### Hashtags

The only hardcoded set is the example block:

```
#NYCConstruction #SidewalkRepair #BronxContractor #BrooklynConstruction #Manhattan
```

Counts are enforced per platform rather than a fixed list: Facebook 4-5 NYC
hashtags, LinkedIn 5-7 hashtags. The model generates the rest.

### Colour hexes (all from `shared_css`)

| Hex | Role |
| --- | --- |
| `#A8232F` | primary brand red — bars, logo block, highlights, borders, footer strong text |
| `#8B1A26` | red gradient mid stop (`.red-card`) |
| `#6B121C` | red gradient end stop (`.red-card`) |
| `#FF6B7A` | light red / salmon — overlines, block labels, contact line |
| `#0A0A0A` | near-black — dark card base, light-card ink, tip number block |
| `#1A1A1A` | dark card gradient mid stop |
| `#F8F8F8` | light card background |
| `#E5E5E5` | light dividers/borders and `.stat-desc` / `.quote-sub-text` text |
| `#B5B5B5` | footer light text |
| `#666` | muted grey — `.tip-sub-dark`, `.footer-gray` |
| `#22C55E` | green — solution block border |
| `#4ADE80` | light green — "DO THIS INSTEAD" label |
| `white` / `rgba(255,255,255,·)` | body text, glass fills, grid lines |
| `rgba(168,35,47,·)` | red at 0.07 / 0.08 / 0.12 / 0.15 / 0.18 / 0.2 / 0.25 / 0.3 / 0.4 / 0.5 for grids, orbs, fills, borders |
| `rgba(0,0,0,·)` | 0.2 / 0.25 / 0.3 shadows, glass badge, author circle |

### Fonts

- Primary: **Inter** (`font-family:'Inter',-apple-system,sans-serif`), requested
  via `google_fonts: "Inter"`. Weights used: 500, 600, 700, 800, 900.
- Secondary: **Georgia, serif** — only for the giant decorative `"` in
  `.quote-deco-bg` (500px, opacity 0.1). Not loaded from Google Fonts.

### Type scale highlights

`mega-stat` 340px / `quote-mega-text` 96px / `service-title` & `cheat-title-dark`
80px / `testimonial-text` 54px / `stat-desc` 40px / `quote-sub-text` 32px /
`stat-block-value` 30px / `block-text`, `tip-main-dark` 28px / `detail-text`,
`warn-text` 26px / body and footers 14-24px. Card padding 80px.

### Fixed decorative strings

`★ SERVICE`, `SINCE 1994`, `▲ <category_tag>`, `◆ PROJECT`, `★ 5-STAR REVIEW`,
`⚠ WARNING`, `✦ <category_tag>`, `EXPERT WORK`, `TRUST FACTOR` (default),
`NYC BUILDING CODE`, `RECENT WORK`, `COMMON MISTAKE`, `OUR APPROACH`,
`THE PROBLEM` / `OUR SOLUTION` / `THE RESULT`, `THE MISTAKE` / `CONSEQUENCE` /
`DO THIS INSTEAD` / `PRO TIP:`, `TIMELINE` / `RESULT`, five `★` stars,
numbered chips `01`-`05`.

### `ifempty()` fallback defaults

Only some fields have non-empty fallbacks — everything else falls back to `""`
(an empty region on the poster):

| Field | Fallback |
| --- | --- |
| `tags[1]` / `tags[2]` / `tags[3]` | `Brownstones` / `Townhouses` / `Commercial` |
| `overline` | `TRUST FACTOR` |
| `big_stat` | `30` |
| `badges[1]` / `badges[2]` / `badges[3]` | `LICENSED` / `INSURED` / `OSHA` |
| `category_tag` (cheatsheet) | `NYC PRO TIPS` |
| `category_tag` (quote) | `PIONEER PHILOSOPHY` |
| `client_initials` | `CD` |

---

## 11. Migration notes

- One LLM call produces everything: both platforms' copy **and** all image data.
  There is no separate image-copy pass and no per-platform pass.
- Template choice is derived from the calendar day only — nothing about the
  generated content influences which layout is used, and nothing lets a human
  override it.
- The rendered image is identical across both platforms; only caption text varies.
- Uniqueness is unmanaged: no history read, no dedupe, no post log. Two runs on
  the same weekday can legitimately produce near-identical posters.
- The three `switch()` expressions (content type, template, final HTML) have no
  default branch, so any unmatched value silently produces an empty string and
  the render would fail or come out blank rather than falling back.
- `parseJSONResponse: true` plus `response_format: json_object` means downstream
  modules read `3.result.*` directly; there is no JSON-parse module and no
  validation of the returned shape before rendering.
