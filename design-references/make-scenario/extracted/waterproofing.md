# Make.com scenario extraction — NYC Waterproofing Daily Content Generator

Reference capture for code migration. Everything below is transcribed from the live
Make blueprint (`scenarios_get`, scenario `9277893`).

## Redaction notice

The following were replaced in place with the literal token `[REDACTED]`, including
where they appear *inside* prompt bodies and HTML templates:

- all connection ids and `__IMTCONN__` values (connection *type* strings kept — they
  identify which app module is used, not an account)
- the Facebook Page id and the LinkedIn organization URN
- every email address, including the business contact email that the prompt and the
  `tpl_project` footer treat as a business constant. The field slot is preserved so the
  migration knows a business-email constant belongs there.
- the owning Make team id and the author's email

Nothing else was removed or shortened. There are **no** API keys, access/refresh tokens,
webhook URLs, Google Sheet ids, datastore ids, Instagram/Pinterest ids or board ids in
this scenario — it holds no credentials inline; every credential is referenced through a
Make connection id.

---

## 1. Scenario

| Field | Value |
|---|---|
| Name | `NYC Waterproofing - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9277893` |
| Team id | `[REDACTED]` |
| Author | `[REDACTED]` |
| Created | 2026-05-22T18:43:56.086Z |
| Last edit | 2026-06-25T12:39:47.432Z |
| Active | `true` (`isActive: true`, `isPaused: false`, `islinked: true`) |
| Folder | none |
| Hook | none (`hookId: null`) — not webhook-triggered |
| Used packages | `builtin`, `util` (x3), `openai-gpt-3`, `html-css-to-image` (x2), `facebook-pages`, `linkedin` |

### Schedule

```json
{
  "type": "indefinitely",
  "interval": 900,
  "restrict": [
    { "days": [1, 2, 3, 4, 5, 6, 0], "time": ["14:00", "14:01"] }
  ]
}
```

Polls every 900 s (15 min), but restricted to a one-minute window `14:00`–`14:01` on all
seven days, so it fires exactly **once per day at 14:00 team-local time**. `nextExec` was
`2026-07-20T09:00:00.000Z`, i.e. the team clock is UTC+5 (14:00 local = 09:00 UTC).

### Scenario metadata

```json
{
  "instant": false,
  "version": 1,
  "designer": { "orphans": [] },
  "scenario": {
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
}
```

`interface.input` and `interface.output` are both empty arrays. `dlqCount: 0`.

---

## 2. Flow (9 modules, strictly linear)

All modules sit on `y: 0`, `x` stepping 0 → 2400 in 300s. **No router, no filters, no
fallback/error-handler routes, no history lookup, no data store, no Google Sheets.**

| # | Module | Version | Purpose |
|---|---|---|---|
| 1 | `builtin:BasicFeeder` | 1 | one-bundle kick-off |
| 2 | `util:SetVariables` | 1 | day rhythm → `content_type`, `image_template` |
| 3 | `openai-gpt-3:CreateCompletion` | 1 | single LLM call, all copy + image data |
| 4 | `util:SetVariables` | 1 | 7 HTML templates + shared CSS |
| 5 | `util:SetVariable2` | 1 | pick `final_html` by template name |
| 6 | `html-css-to-image:Image` | 1 | render |
| 7 | `html-css-to-image:GetImage` | 1 | fetch the PNG binary |
| 8 | `facebook-pages:UploadPhoto` | 6 | publish to Facebook Page |
| 9 | `linkedin:CreateCompanyImagePost` | 2 | publish to LinkedIn company page |

### Module 1 — `builtin:BasicFeeder`

```json
{ "mapper": { "array": "[{\"trigger\":\"start\"}]" }, "parameters": {} }
```

A hardcoded single-element array is the trigger payload — the scheduler runs the scenario
and the feeder emits exactly one bundle.

---

## 3. Module 2 — `util:SetVariables` (rhythm)

`scope: "roundtrip"`.

**`day_of_week`**

```
{{formatDate(now; "dddd")}}
```

**`content_type`**

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_spotlight"; "Tuesday"; "trust_stat"; "Wednesday"; "nyc_code_tip"; "Thursday"; "project_showcase"; "Friday"; "customer_testimonial"; "Saturday"; "pro_tip_warning"; "Sunday"; "brand_insight")}}
```

**`image_template`**

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_card"; "Tuesday"; "stat_card"; "Wednesday"; "cheatsheet"; "Thursday"; "project_card"; "Friday"; "testimonial"; "Saturday"; "warning_card"; "Sunday"; "quote_card")}}
```

Resolved rhythm:

| Day | `content_type` | `image_template` |
|---|---|---|
| Monday | `service_spotlight` | `service_card` |
| Tuesday | `trust_stat` | `stat_card` |
| Wednesday | `nyc_code_tip` | `cheatsheet` |
| Thursday | `project_showcase` | `project_card` |
| Friday | `customer_testimonial` | `testimonial` |
| Saturday | `pro_tip_warning` | `warning_card` |
| Sunday | `brand_insight` | `quote_card` |

Note there is no default branch on either switch — an unmatched day yields an empty
string, which would also empty `final_html` at module 5.

---

## 4. Module 3 — `openai-gpt-3:CreateCompletion`

| Parameter | Value |
|---|---|
| `select` | `chat` |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `2500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| Connection | `[REDACTED]` (type `openai-gpt-3`) |

Downstream modules read the parsed object as `3.result.<field>`.

### System prompt (verbatim)

```text
You are the Marketing Lead for NYC Waterproofing, a 24/7 licensed and insured waterproofing contractor in NYC serving all 5 boroughs plus Westchester.

BUSINESS:
- Phone: (917) 415-1383
- Email: [REDACTED]
- Website: https://nyc-waterproofing.com/
- Address: 12115 103rd Avenue, Queens, NY 11419
- Service areas: Manhattan, Brooklyn, Queens, Bronx + Yonkers, Mount Vernon, New Rochelle, White Plains, Westchester
- 24/7 Available

SERVICES: Basement Waterproofing, Foundation Waterproofing, Roof Waterproofing, Crawl Space Waterproofing, Interior Waterproofing, Bathroom & Kitchen Waterproofing, Commercial Waterproofing, Parapet Wall Sealing, Balcony & Deck Waterproofing, Leak Detection, Concrete Coating, Waterproof Membranes (TPO, EPDM, liquid).

RULES:
- First-person as NYC Waterproofing
- NO emojis, no fancy symbols
- Plain numbered lists (1. 2. 3.)
- \n\n between every paragraph and every list item
- Each post ends with phone, email, website on separate lines
- 4-7 NYC-relevant hashtags at end
- NYC-specific (boroughs, basement flooding, brownstone foundations, weather)
- NO double quotes inside text values

You MUST output valid JSON with image_data fields FILLED with real content for today's template. No placeholders, no dots.

TODAY: {{2.day_of_week}} | Content type: {{2.content_type}} | Template: {{2.image_template}}

For template = service_card: fill service_name, service_subtitle, problem_text, solution_text, result_text, tags (3 items like 'Basements', 'Foundations', 'Roofs').

For template = stat_card: fill big_stat (e.g. 24/7, 100, 5), stat_label, overline (1-2 words), badges (3 items like LICENSED/INSURED/24-7).

For template = cheatsheet: fill title_line1, title_line2 (highlighted), category_tag, tips (5 short), tip_subtitles (5 short).

For template = project_card: fill project_type, project_location, detail_1, detail_2, detail_3, timeline, result_highlight.

For template = testimonial: fill review_quote (12-18 words), review_subtitle, client_name, client_location, client_initials.

For template = warning_card: fill warning_title, highlight_word, mistake_description, consequence, solution_text_warning, pro_tip.

For template = quote_card: fill quote_part1, quote_part2 (highlighted), subquote, category_tag.

For OTHER templates' fields, use empty string "".

Keep image text SHORT (poster format). Real values only.

Output valid JSON:
{
  "topic": "3-5 word topic",
  "service_focus": "which service",
  "facebook_post": "180-280 words with proper formatting and contact info",
  "linkedin_post": "250-350 words professional B2B with contact info",
  "image_data": {
    "service_name": "",
    "service_subtitle": "",
    "problem_text": "",
    "solution_text": "",
    "result_text": "",
    "tags": [],
    "big_stat": "",
    "stat_label": "",
    "overline": "",
    "badges": [],
    "title_line1": "",
    "title_line2": "",
    "category_tag": "",
    "tips": [],
    "tip_subtitles": [],
    "project_type": "",
    "project_location": "",
    "detail_1": "",
    "detail_2": "",
    "detail_3": "",
    "timeline": "",
    "result_highlight": "",
    "review_quote": "",
    "review_subtitle": "",
    "client_name": "",
    "client_location": "",
    "client_initials": "",
    "warning_title": "",
    "highlight_word": "",
    "mistake_description": "",
    "consequence": "",
    "solution_text_warning": "",
    "pro_tip": "",
    "quote_part1": "",
    "quote_part2": "",
    "subquote": ""
  }
}

Fill the fields matching today's template ({{2.image_template}}) with REAL content. Leave others as empty strings.
```

Note: the `\n\n` on the RULES line is a literal backslash-n-backslash-n in the prompt
source (JSON `\\n\\n`), i.e. the model is being told to emit the two-character escape
sequence between paragraphs, not an actual blank line.

### User prompt (verbatim)

```text
Generate today's post for NYC Waterproofing.

Day: {{2.day_of_week}}
Content type: {{2.content_type}}
Template: {{2.image_template}}

Make it fresh, NYC-specific, about waterproofing, basement leaks, foundations, roofs, mold prevention. Fill image_data fields for template {{2.image_template}} with REAL short text.

Return JSON only.
```

### Demanded JSON output schema, with per-field constraints

| Field | Type | Constraint stated in prompt |
|---|---|---|
| `topic` | string | 3–5 word topic |
| `service_focus` | string | which service |
| `facebook_post` | string | 180–280 words, proper formatting, contact info |
| `linkedin_post` | string | 250–350 words, professional B2B, contact info |
| `image_data` | object | 36 keys, below |

`image_data` keys grouped by the template that owns them — every key not owned by today's
template must be `""` (or `[]`):

**service_card** — `service_name`, `service_subtitle`, `problem_text`, `solution_text`,
`result_text`, `tags` (array, 3 items, e.g. `Basements` / `Foundations` / `Roofs`)

**stat_card** — `big_stat` (e.g. `24/7`, `100`, `5`), `stat_label`, `overline` (1–2 words),
`badges` (array, 3 items, e.g. `LICENSED` / `INSURED` / `24-7`)

**cheatsheet** — `title_line1`, `title_line2` (highlighted), `category_tag`, `tips` (array,
5 short), `tip_subtitles` (array, 5 short)

**project_card** — `project_type`, `project_location`, `detail_1`, `detail_2`, `detail_3`,
`timeline`, `result_highlight`

**testimonial** — `review_quote` (12–18 words), `review_subtitle`, `client_name`,
`client_location`, `client_initials`

**warning_card** — `warning_title`, `highlight_word`, `mistake_description`, `consequence`,
`solution_text_warning`, `pro_tip`

**quote_card** — `quote_part1`, `quote_part2` (highlighted), `subquote`, `category_tag`
(shared with cheatsheet)

Global copy constraints: first person as the business; no emojis or fancy symbols; plain
numbered lists (`1. 2. 3.`); `\n\n` between every paragraph and list item; every post ends
with phone, email and website on separate lines; 4–7 NYC-relevant hashtags at the end;
NYC-specific references; no double quotes inside any text value; image text must be short
(poster format) and contain real values, never placeholders or dots.

---

## 5. Module 4 — `util:SetVariables` (templates)

`scope: "roundtrip"`. Eight variables: seven HTML fragments plus one shared stylesheet.
All values are single-line strings, reproduced verbatim below. Attribute quoting is single
quotes throughout so the strings can be embedded in Make's double-quoted JSON.

Every dynamic slot is `{{ifempty(3.result.image_data.<field>; "<fallback>")}}`, and array
items use `{{ifempty(get(3.result.image_data.<array>; <n>); "<fallback>")}}` — so a blank
LLM field silently degrades to a hardcoded default rather than rendering an empty poster.

### `tpl_service`

```html
<div class='card dark-card'><div class='red-top-bar'></div><div class='grid-bg'></div><div class='red-orb'></div><div class='header'><div class='logo-group'><span class='brand-nyc'>NYC</span><span class='brand-sub'>WATERPROOFING</span></div><div class='badge-red-border'>★ SERVICE</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>EXPERT WATERPROOFING</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.service_name; "Basement")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.service_subtitle; "Waterproofing")}}</span></h1></div><div class='service-blocks'><div class='block-left-red'><div class='block-label'>THE PROBLEM</div><div class='block-text'>{{ifempty(3.result.image_data.problem_text; "Water leaks damage basements and foundations")}}</div></div><div class='block-left-red'><div class='block-label'>OUR SOLUTION</div><div class='block-text'>{{ifempty(3.result.image_data.solution_text; "Complete sealing, drainage, sump pumps")}}</div></div><div class='block-left-red'><div class='block-label'>THE RESULT</div><div class='block-text'>{{ifempty(3.result.image_data.result_text; "Dry, mold-free space that lasts")}}</div></div><div class='tag-row'><div class='tag-red'>● {{ifempty(get(3.result.image_data.tags; 1); "Basements")}}</div><div class='tag-red'>● {{ifempty(get(3.result.image_data.tags; 2); "Foundations")}}</div><div class='tag-red'>● {{ifempty(get(3.result.image_data.tags; 3); "Roofs")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>24/7 emergency service NYC</span><span class='footer-red-strong'>(917) 415-1383</span></div></div>
```

### `tpl_stat`

```html
<div class='card dark-card'><div class='red-top-bar'></div><div class='grid-bg'></div><div class='red-orb-top'></div><div class='header'><div class='logo-group'><span class='brand-nyc'>NYC</span><span class='brand-sub'>WATERPROOFING</span></div><div class='badge-red-border'>LICENSED & INSURED</div></div><div class='stat-body'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>{{ifempty(3.result.image_data.overline; "AVAILABILITY")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.big_stat; "24")}}<span class='red-suffix'>/7</span></div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "Emergency waterproofing across all NYC boroughs day or night")}}</div><div class='badge-row'><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 1); "LICENSED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 2); "INSURED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 3); "24-7")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>(917) 415-1383</span><span class='footer-red-strong'>nyc-waterproofing.com →</span></div></div>
```

Note the `/7` suffix is hardcoded in the markup, so `big_stat` is always rendered as
`<value>/7` regardless of what the model returns.

### `tpl_cheat`

```html
<div class='card light-card'><div class='red-top-bar'></div><div class='light-orb'></div><div class='header light-header-style'><div class='logo-group'><span class='brand-nyc-dark'>NYC</span><span class='brand-sub-red'>WATERPROOFING</span></div><div class='badge-red-solid'>▲ {{ifempty(3.result.image_data.category_tag; "NYC TIPS")}}</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red-light'>WATERPROOFING GUIDE</span></div><h1 class='cheat-title-dark'>{{ifempty(3.result.image_data.title_line1; "5 signs your home")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.title_line2; "needs waterproofing")}}</span></h1></div><div class='tip-list-light'><div class='tip-card-light'><div class='tip-num-black'>01</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 1); "Musty basement smell")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "First sign of moisture problems")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>02</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 2); "Water stains on walls")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "Hidden leaks getting worse")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>03</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 3); "Cracks in foundation")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "Water path forming inside")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>04</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 4); "Mold or mildew growth")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "Health hazard needs urgent care")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>05</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 5); "Standing water after rain")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "Drainage system needs upgrade")}}</span></div></div></div><div class='card-footer light-footer-style'><span class='footer-gray'>Call (917) 415-1383</span><span class='footer-red-strong'>nyc-waterproofing.com →</span></div></div>
```

### `tpl_project`

```html
<div class='card dark-card'><div class='red-top-bar'></div><div class='grid-bg'></div><div class='red-orb'></div><div class='header'><div class='logo-group'><span class='brand-nyc'>NYC</span><span class='brand-sub'>WATERPROOFING</span></div><div class='badge-red-border'>◆ PROJECT</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>RECENT WORK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.project_type; "Basement Sealing")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.project_location; "Bronx")}}</span></h1></div><div class='project-details'><div class='detail-row'><div class='detail-icon-red'>01</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_1; "Full wall and floor sealing")}}</div></div><div class='detail-row'><div class='detail-icon-red'>02</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_2; "Sump pump installation")}}</div></div><div class='detail-row'><div class='detail-icon-red'>03</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_3; "Drainage system added")}}</div></div><div class='project-stats'><div class='stat-block'><div class='stat-block-label'>TIMELINE</div><div class='stat-block-value'>{{ifempty(3.result.image_data.timeline; "2 days")}}</div></div><div class='stat-block-divider'></div><div class='stat-block'><div class='stat-block-label'>RESULT</div><div class='stat-block-value'>{{ifempty(3.result.image_data.result_highlight; "Permanently dry")}}</div></div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>[REDACTED]</span><span class='footer-red-strong'>(917) 415-1383</span></div></div>
```

The redacted footer slot held the business contact email as a hardcoded literal — it is
the only template that puts the email on the poster.

### `tpl_testimonial`

```html
<div class='card red-card'><div class='grid-bg-light'></div><div class='quote-deco-bg'>&ldquo;</div><div class='dark-orb-bottom'></div><div class='header'><div class='logo-group'><span class='brand-nyc-white'>NYC</span><span class='brand-sub-white'>WATERPROOFING</span></div><div class='badge-glass'>★ 5-STAR REVIEW</div></div><div class='quote-body'><div class='stars-row'><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span></div><div class='testimonial-text'>{{ifempty(3.result.image_data.review_quote; "They fixed our wet basement in one day. No more mold or smell.")}}</div><div class='testimonial-sub'>{{ifempty(3.result.image_data.review_subtitle; "Clean, fast, and professional work throughout.")}}</div></div><div class='card-footer red-card-footer'><div class='author-block'><div class='author-circle'>{{ifempty(3.result.image_data.client_initials; "KJ")}}</div><div class='author-info'><div class='author-name'>{{ifempty(3.result.image_data.client_name; "Kim J.")}}</div><div class='author-role'>{{ifempty(3.result.image_data.client_location; "Bronx")}}</div></div></div><span class='url-light'>nyc-waterproofing.com</span></div></div>
```

Five stars are hardcoded markup, and the fallback client name/quote is a fabricated
review — worth flagging for any migration that must not invent testimonials.

Two defects in the source, carried through verbatim: `quote-body` is the only class used
in any template that has **no** rule in `shared_css` (102 rules defined, 103 classes used),
so the testimonial quote container renders unstyled as a plain block; and this is also the
only card whose body sits between a `space-between` header and footer with no flex sizing
of its own.

### `tpl_warning`

```html
<div class='card dark-card'><div class='red-top-bar-thick'></div><div class='grid-bg'></div><div class='red-orb'></div><div class='header'><div class='logo-group'><span class='brand-nyc'>NYC</span><span class='brand-sub'>WATERPROOFING</span></div><div class='badge-warning'>⚠ WARNING</div></div><div class='title-block'><div class='overline-row'><div class='red-bar'></div><span class='overline-red'>COMMON MISTAKE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.warning_title; "Do not ignore")}}<br><span class='red-highlight'>{{ifempty(3.result.image_data.highlight_word; "basement leaks")}}</span></h1></div><div class='warning-blocks'><div class='warn-block'><div class='warn-label-red'>THE MISTAKE</div><div class='warn-text'>{{ifempty(3.result.image_data.mistake_description; "Ignoring small water stains and damp spots in basement")}}</div></div><div class='warn-block consequence-block'><div class='warn-label-red'>CONSEQUENCE</div><div class='warn-text'>{{ifempty(3.result.image_data.consequence; "Mold, foundation damage, costly repairs")}}</div></div><div class='warn-block solution-block'><div class='warn-label-green'>DO THIS INSTEAD</div><div class='warn-text-white'>{{ifempty(3.result.image_data.solution_text_warning; "Call us at first sign of moisture problems")}}</div></div><div class='pro-tip-bar'><span class='pro-tip-label'>PRO TIP:</span> {{ifempty(3.result.image_data.pro_tip; "Inspect basement after every heavy rainstorm in NYC")}}</div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Avoid costly mistakes</span><span class='footer-red-strong'>(917) 415-1383</span></div></div>
```

### `tpl_quote`

```html
<div class='card black-quote-card'><div class='grid-bg'></div><div class='red-side-bar'></div><div class='red-orb-large'></div><div class='header'><div class='logo-group'><span class='brand-nyc'>NYC</span><span class='brand-sub'>WATERPROOFING</span></div><div class='badge-red-border'>✦ {{ifempty(3.result.image_data.category_tag; "OUR PROMISE")}}</div></div><div class='quote-block-center'><div class='red-accent-bar'></div><div class='overline-red-quote'>OUR APPROACH</div><div class='quote-mega-text'>{{ifempty(3.result.image_data.quote_part1; "Dry homes mean")}} <span class='red-highlight'>{{ifempty(3.result.image_data.quote_part2; "healthy families")}}</span></div><div class='quote-sub-text'>{{ifempty(3.result.image_data.subquote; "We protect NYC homes and buildings from water damage with proven solutions.")}}</div></div><div class='card-footer dark-footer'><div class='since-block'><div class='since-number'>24/7</div><div class='since-text'>EMERGENCY<br>SERVICE</div></div><div class='contact-stack'><span class='contact-line'>(917) 415-1383</span><span class='contact-line-red'>nyc-waterproofing.com</span></div></div></div>
```

### `shared_css` (verbatim, one line in source)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.dark-card{background:linear-gradient(135deg,#0B1A2E 0%,#152B4A 50%,#0B1A2E 100%);color:white}.light-card{background:#F8FAFC;color:#0B1A2E;gap:32px;justify-content:flex-start}.red-card{background:linear-gradient(135deg,#DC2626 0%,#B91C1C 50%,#7F1D1D 100%);color:white}.black-quote-card{background:#0B1A2E;color:white;justify-content:center}.red-top-bar{position:absolute;top:0;left:0;width:100%;height:12px;background:#DC2626;z-index:5}.red-top-bar-thick{position:absolute;top:0;left:0;width:100%;height:16px;background:#DC2626;z-index:5}.red-side-bar{position:absolute;top:0;left:0;width:12px;height:100%;background:#DC2626;z-index:5}.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(220,38,38,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(220,38,38,0.07) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.grid-bg-light{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.05) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.red-orb{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,38,0.25) 0%,transparent 70%);pointer-events:none;z-index:1}.red-orb-top{position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,38,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.red-orb-large{position:absolute;bottom:-300px;right:-300px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,38,0.2) 0%,transparent 70%);pointer-events:none;z-index:1}.light-orb{position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:rgba(220,38,38,0.08);pointer-events:none;z-index:1}.dark-orb-bottom{position:absolute;bottom:-300px;left:-300px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.quote-deco-bg{position:absolute;top:60px;right:60px;font-size:500px;line-height:0.6;opacity:0.1;font-family:Georgia,serif;font-weight:900;color:white;pointer-events:none;z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3;padding-top:8px}.light-header-style{padding-bottom:28px;border-bottom:3px solid #E2E8F0}.logo-group{display:flex;flex-direction:column;gap:4px}.brand-nyc{font-size:60px;font-weight:900;letter-spacing:6px;color:#DC2626;line-height:1;font-family:'Inter',sans-serif}.brand-nyc-dark{font-size:60px;font-weight:900;letter-spacing:6px;color:#0B1A2E;line-height:1;font-family:'Inter',sans-serif}.brand-nyc-white{font-size:60px;font-weight:900;letter-spacing:6px;color:white;line-height:1;font-family:'Inter',sans-serif}.brand-sub{font-size:14px;font-weight:700;letter-spacing:5px;color:white}.brand-sub-red{font-size:14px;font-weight:700;letter-spacing:5px;color:#DC2626}.brand-sub-white{font-size:14px;font-weight:700;letter-spacing:5px;color:rgba(255,255,255,0.9)}.badge-red-border{background:rgba(220,38,38,0.15);border:2px solid #DC2626;padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-red-solid{background:#DC2626;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-warning{background:#DC2626;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-glass{background:rgba(0,0,0,0.25);border:2px solid rgba(255,255,255,0.3);padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.title-block{position:relative;z-index:3}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}.red-bar{width:36px;height:6px;background:#DC2626}.overline-red{font-size:20px;color:#FCA5A5;font-weight:900;letter-spacing:4px}.overline-red-light{font-size:20px;color:#DC2626;font-weight:900;letter-spacing:4px}.overline-red-quote{font-size:24px;color:#FCA5A5;font-weight:900;letter-spacing:5px;margin-bottom:24px}.service-title{font-size:80px;font-weight:900;color:white;line-height:1.05;letter-spacing:-2.5px}.cheat-title-dark{font-size:80px;font-weight:900;color:#0B1A2E;line-height:1.05;letter-spacing:-2.5px}.red-highlight{color:#DC2626}.service-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.block-left-red{background:rgba(255,255,255,0.05);border-left:6px solid #DC2626;padding:22px 28px}.block-label{font-size:18px;color:#FCA5A5;font-weight:900;letter-spacing:3px;margin-bottom:8px}.block-text{font-size:28px;color:white;font-weight:700;line-height:1.35}.tag-row{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.tag-red{background:rgba(220,38,38,0.18);padding:10px 20px;font-size:18px;color:white;font-weight:700;letter-spacing:0.5px}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.mega-stat{font-size:340px;font-weight:900;color:white;line-height:0.95;letter-spacing:-14px;margin-bottom:16px}.red-suffix{color:#DC2626}.stat-desc{font-size:40px;color:#CBD5E1;line-height:1.3;font-weight:500;max-width:900px}.badge-row{display:flex;gap:16px;margin-top:36px;flex-wrap:wrap}.trust-badge{background:rgba(220,38,38,0.15);border-left:6px solid #DC2626;padding:14px 24px;font-size:20px;color:white;font-weight:900;letter-spacing:2px}.tip-list-light{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card-light{background:white;border-left:8px solid #DC2626;padding:20px 26px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)}.tip-num-black{background:#0B1A2E;color:white;min-width:62px;height:62px;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main-dark{font-size:28px;color:#0B1A2E;font-weight:900;line-height:1.25}.tip-sub-dark{font-size:18px;color:#64748B;font-weight:500;line-height:1.3}.project-details{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.detail-row{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,0.04);border-left:6px solid #DC2626;padding:20px 26px}.detail-icon-red{background:#DC2626;color:white;min-width:56px;height:56px;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center}.detail-text{font-size:26px;color:white;font-weight:600;line-height:1.3}.project-stats{display:flex;align-items:center;gap:32px;margin-top:8px;background:rgba(220,38,38,0.12);border:2px solid rgba(220,38,38,0.4);padding:24px 32px}.stat-block{flex:1}.stat-block-label{font-size:16px;color:#FCA5A5;font-weight:900;letter-spacing:3px;margin-bottom:6px}.stat-block-value{font-size:30px;color:white;font-weight:900;line-height:1.2}.stat-block-divider{width:2px;height:60px;background:rgba(220,38,38,0.4)}.stars-row{display:flex;gap:6px;margin-bottom:20px}.star{color:white;font-size:48px;font-weight:900}.testimonial-text{font-size:54px;font-weight:900;line-height:1.2;letter-spacing:-1.5px;color:white}.testimonial-sub{font-size:24px;opacity:0.9;margin-top:18px;font-weight:500;line-height:1.4}.author-block{display:flex;align-items:center;gap:18px}.author-circle{width:60px;height:60px;border-radius:50%;background:rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white}.author-info{display:flex;flex-direction:column}.author-name{font-size:22px;font-weight:900;color:white}.author-role{font-size:18px;opacity:0.85;color:white;font-weight:500}.warning-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.warn-block{background:rgba(255,255,255,0.05);border-left:6px solid #DC2626;padding:22px 28px}.consequence-block{background:rgba(220,38,38,0.15);border-left:6px solid #DC2626}.solution-block{background:rgba(34,197,94,0.12);border-left:6px solid #22C55E}.warn-label-red{font-size:18px;color:#FCA5A5;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-label-green{font-size:18px;color:#4ADE80;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-text{font-size:26px;color:white;font-weight:700;line-height:1.35}.warn-text-white{font-size:26px;color:white;font-weight:700;line-height:1.35}.pro-tip-bar{background:rgba(220,38,38,0.2);padding:18px 24px;font-size:22px;color:white;font-weight:600;line-height:1.4;border:2px solid rgba(220,38,38,0.5);margin-top:8px}.pro-tip-label{color:#FCA5A5;font-weight:900;letter-spacing:2px;margin-right:8px}.quote-block-center{position:relative;z-index:3;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:880px}.red-accent-bar{height:8px;width:80px;background:#DC2626;margin-bottom:24px}.quote-mega-text{font-size:96px;font-weight:900;line-height:1.05;letter-spacing:-3px;color:white;margin-bottom:28px}.quote-sub-text{font-size:32px;color:#CBD5E1;line-height:1.4;font-weight:500;max-width:780px}.since-block{display:flex;align-items:center;gap:14px}.since-number{font-size:70px;font-weight:900;color:#DC2626;line-height:1}.since-text{font-size:14px;font-weight:900;color:white;letter-spacing:2.5px;line-height:1.3}.contact-stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.contact-line{font-size:22px;color:white;font-weight:700;letter-spacing:1px}.contact-line-red{font-size:18px;color:#FCA5A5;font-weight:700;letter-spacing:0.5px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;position:relative;z-index:3}.dark-footer{border-top:2px solid rgba(220,38,38,0.4)}.light-footer-style{border-top:3px solid #E2E8F0}.red-card-footer{border-top:2px solid rgba(255,255,255,0.3)}.footer-light-text{font-size:20px;color:#94A3B8;letter-spacing:1px;font-weight:600}.footer-red-strong{font-size:22px;color:#DC2626;font-weight:900;letter-spacing:0.5px}.footer-gray{font-size:20px;color:#64748B;font-weight:700;letter-spacing:0.5px}.url-light{font-size:20px;color:white;opacity:0.9;letter-spacing:1.5px;font-weight:600}
```

---

## 6. Module 5 — `util:SetVariable2` (template selection)

Name `final_html`, `scope: "roundtrip"`:

```
{{switch(2.image_template; "service_card"; 4.tpl_service; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "project_card"; 4.tpl_project; "testimonial"; 4.tpl_testimonial; "warning_card"; 4.tpl_warning; "quote_card"; 4.tpl_quote)}}
```

No default branch.

---

## 7. Modules 6 & 7 — rendering (`html-css-to-image`)

**Module 6, `html-css-to-image:Image`**

| Parameter | Value |
|---|---|
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `device_scale` | `2` |
| `google_fonts` | `Inter` |
| Connection | `[REDACTED]` (type `html-css-to-image`) |

Effective output is 2160x2160 px from a 1080x1080 canvas.

**Module 7, `html-css-to-image:GetImage`**

| Parameter | Value |
|---|---|
| `image_id` | `{{6.id}}` |
| `format` | `png` |
| Connection | `[REDACTED]` (type `html-css-to-image`) |

Rendering is two-step: create the image record, then fetch the binary (`7.image`) and its
`7.fileName` for the publishers.

---

## 8. Modules 8 & 9 — publishing

**Module 8, `facebook-pages:UploadPhoto` (v6)**

| Parameter | Value |
|---|---|
| `page_id` | `[REDACTED]` |
| `message` | `{{3.result.facebook_post}}` |
| `data` | `{{7.image}}` |
| `fileName` | `{{7.fileName}}` |
| Connection | `[REDACTED]` (type `facebook`) |

**Module 9, `linkedin:CreateCompanyImagePost` (v2)**

| Parameter | Value |
|---|---|
| `organization` | `[REDACTED]` (an `urn:li:organization:` URN) |
| `method` | `upload` |
| `content` | `{{3.result.linkedin_post}}` |
| `title` | `{{3.result.topic}}` |
| `altText` | `NYC Waterproofing insights` (hardcoded) |
| `data` | `{{7.image}}` |
| `fileName` | `{{7.fileName}}` |
| `visibility` | `PUBLIC` |
| `feedDistribution` | `MAIN_FEED` |
| `isReshareDisabledByAuthor` | `false` |
| Connection | `[REDACTED]` (type `linkedin2`) |

No Instagram, Threads or Pinterest module exists in this scenario. `service_focus` is
generated but never consumed by any downstream module.

---

## 9. Hardcoded business constants

Sources: `sys` = system prompt, `tpl` = HTML templates, `css` = stylesheet.

| Constant | Value | Where |
|---|---|---|
| Business name | NYC Waterproofing | sys, tpl (wordmark) |
| Wordmark | `NYC` + `WATERPROOFING`, letter-spaced text — no image asset | tpl, css |
| Positioning | 24/7 licensed and insured waterproofing contractor, all 5 boroughs plus Westchester | sys |
| Phone | (917) 415-1383 | sys; footers of tpl_service, tpl_stat, tpl_cheat, tpl_project, tpl_warning, tpl_quote |
| Email | `[REDACTED]` | sys, tpl_project footer |
| Website | https://nyc-waterproofing.com/ (shown as `nyc-waterproofing.com` or `nyc-waterproofing.com →`) | sys, tpl_stat, tpl_cheat, tpl_testimonial, tpl_quote |
| Address | 12115 103rd Avenue, Queens, NY 11419 | sys |
| Service areas | Manhattan, Brooklyn, Queens, Bronx + Yonkers, Mount Vernon, New Rochelle, White Plains, Westchester | sys |
| Services (12) | Basement Waterproofing, Foundation Waterproofing, Roof Waterproofing, Crawl Space Waterproofing, Interior Waterproofing, Bathroom & Kitchen Waterproofing, Commercial Waterproofing, Parapet Wall Sealing, Balcony & Deck Waterproofing, Leak Detection, Concrete Coating, Waterproof Membranes (TPO, EPDM, liquid) | sys |
| CTA / footer lines | `24/7 emergency service NYC`, `Call (917) 415-1383`, `Avoid costly mistakes`, `24/7 EMERGENCY SERVICE`, `nyc-waterproofing.com →`; posts must end with phone, email, website on separate lines | sys, tpl |
| Badge labels | `★ SERVICE`, `LICENSED & INSURED`, `◆ PROJECT`, `★ 5-STAR REVIEW`, `⚠ WARNING`, `▲ <category_tag>`, `✦ <category_tag>` | tpl |
| Overlines | `EXPERT WATERPROOFING`, `RECENT WORK`, `COMMON MISTAKE`, `WATERPROOFING GUIDE`, `OUR APPROACH` | tpl |
| Hashtags | **none hardcoded** — the prompt only asks for "4-7 NYC-relevant hashtags at end", generated per post | sys |
| Logo URL | **none** — no image asset is fetched anywhere in the scenario | — |

### Colour palette (all literal hex in `shared_css`)

| Hex | Role |
|---|---|
| `#DC2626` | primary red (bars, accents, highlights, badges, borders) |
| `#B91C1C` | red gradient mid (testimonial card) |
| `#7F1D1D` | red gradient end (testimonial card) |
| `#FCA5A5` | light red for overlines, block labels, secondary contact line |
| `#0B1A2E` | primary navy (dark card base, quote card, light-card ink, tip numerals) |
| `#152B4A` | navy gradient mid |
| `#F8FAFC` | light card background |
| `#E2E8F0` | light card rules/borders |
| `#CBD5E1` | body text on dark |
| `#94A3B8` | dark footer text |
| `#64748B` | muted grey (tip subtitles, light footer) |
| `#22C55E` | green border on the "DO THIS INSTEAD" block |
| `#4ADE80` | green label text |
| `white` / `rgba(255,255,255,…)` / `rgba(0,0,0,…)` | overlays, glass badges, orbs, grid lines |

### Type

- `Inter` — everything (`*` rule, `-apple-system, sans-serif` fallback); the only family
  requested from `google_fonts`.
- `Georgia, serif` — the oversized decorative quote glyph only (`.quote-deco-bg`), not
  loaded via `google_fonts`, so it resolves against the render host's fonts.
- Weights used: 500, 600, 700, 800, 900. Display sizes run to 340px (`.mega-stat`) and
  500px (decorative quote mark).

---

## 10. Control flow, filters, error handling, history

- **Filters:** none. No module has a `filter` key; the flow is unconditional end to end.
- **Routers:** none.
- **Error handlers:** no directive routes (`ignore` / `resume` / `commit` / `rollback` /
  `break`) on any module. Scenario-level `maxErrors: 3`, `dlq: false`, `dataloss: false`,
  `autoCommit: true`, `autoCommitTriggerLast: true`, `sequential: false`, `roundtrips: 1`.
  A failure in the OpenAI, render or publish step simply fails the run.
- **History / dedupe:** **none.** There is no data store, no Google Sheet, no "search
  recent posts" module and nothing feeding prior topics back into the prompt. Repetition is
  resisted only by `temperature: 0.85` and the word "fresh" in the user prompt. Two runs on
  the same weekday can produce the same topic with nothing to detect it.
- **Idempotency:** none. If the scenario ran twice inside the 14:00–14:01 window it would
  publish twice; the single-minute restriction against a 15-minute interval is what
  prevents that.

### Fidelity check

Transcription was verified mechanically against the blueprint: `shared_css` is one line of
10,364 chars defining 102 rules; 7 HTML templates carry 103 distinct classes and 49
`ifempty(...)` slots. Every class resolves to a rule except `quote-body` (see above).
