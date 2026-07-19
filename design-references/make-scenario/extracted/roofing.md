# Make.com Scenario Extraction — Makkah Roofing Contractor NYC

Reference extraction for code migration. Captured from the live Make blueprint.

**Redaction note:** per policy, every connection id, `__IMTCONN__` value, Facebook page
id, LinkedIn organization id and **every email address** has been replaced with the
literal token `[REDACTED]`. This includes the *business contact email*, which appears
verbatim in two places in the source (the OpenAI system prompt `BUSINESS:` block and
the `tpl_project` card footer) — those are real values in Make, redacted here.
Everything else (prompt text, rhythm logic, HTML/CSS, phone, website, address,
services, colours, fonts) is verbatim.

---

## 1. Scenario identity and schedule

| Field | Value |
| --- | --- |
| Name | `Makkah Roofing Contractor NYC - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9277758` |
| Team id | `2388544` |
| Folder | none (`folderId: null`) |
| Active | `true` (`isPaused: false`, `isinvalid: false`) |
| Created | `2026-05-22T17:45:26.890Z` |
| Last edit | `2026-06-25T12:34:19.168Z` |
| Next exec (at capture) | `2026-07-20T09:00:00.000Z` |
| Trigger type | polling / scheduled (`metadata.instant: false`), no hook (`hookId: null`) |

### Scheduling block (verbatim)

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

- `interval: 900` = 900 seconds (15 minutes) between polls.
- `restrict.days` `[1,2,3,4,5,6,0]` = Make weekday numbering `0 = Sunday … 6 = Saturday`,
  so **all seven days** are enabled.
- `restrict.time` `["14:00", "14:01"]` = a **one-minute window at 14:00 local**. Combined
  with the 15-minute interval this fires effectively **once per day**.
- **No `timezone` key is present** on the scenario or the blueprint — the scenario
  inherits the Make organization/team timezone. Circumstantial evidence: the captured
  `nextExec` of `09:00:00Z` for a `14:00` local slot implies the inherited zone is
  **UTC+5** (consistent with `Asia/Karachi`), not America/New_York. Do not treat this
  as a declared field; it is inferred and must be made explicit on migration.

### Scenario-level runtime metadata (verbatim)

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

`interface.input` and `interface.output` are both empty arrays.

### Module flow (9 modules, strictly linear — no branches)

| # | Module | Package | Purpose |
| --- | --- | --- | --- |
| 1 | `builtin:BasicFeeder` v1 | builtin | Emits one bundle to start the run |
| 2 | `util:SetVariables` v1 | util | Day + rhythm variables |
| 3 | `openai-gpt-3:CreateCompletion` v1 | openai-gpt-3 | Generates all copy + image data |
| 4 | `util:SetVariables` v1 | util | 7 HTML templates + shared CSS |
| 5 | `util:SetVariable2` v1 | util | Selects today's template into `final_html` |
| 6 | `html-css-to-image:Image` v1 | html-css-to-image | Renders the 1080×1080 image |
| 7 | `html-css-to-image:GetImage` v1 | html-css-to-image | Downloads the PNG binary |
| 8 | `facebook-pages:UploadPhoto` v6 | facebook-pages | Posts photo + caption to Page |
| 9 | `linkedin:CreateCompanyImagePost` v2 | linkedin | Posts image + copy to company page |

---

## 2. Module 1 — `builtin:BasicFeeder`

Designer position `x: 0, y: 0`. No connection. Parameters empty.

```json
{ "array": "[{\"trigger\":\"start\"}]" }
```

A single-bundle iterator used purely to give the scheduled run one bundle to work on.

---

## 3. Module 2 — `util:SetVariables` (rhythm)

Designer position `x: 300, y: 0`. `scope: "roundtrip"`. Three variables.

### `day_of_week`

```
{{formatDate(now; "dddd")}}
```

### `content_type` — full rotation expression (verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_spotlight"; "Tuesday"; "trust_stat"; "Wednesday"; "nyc_code_tip"; "Thursday"; "project_showcase"; "Friday"; "customer_testimonial"; "Saturday"; "pro_tip_warning"; "Sunday"; "brand_insight")}}
```

### `image_template` — full rotation expression (verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_card"; "Tuesday"; "stat_card"; "Wednesday"; "cheatsheet"; "Thursday"; "project_card"; "Friday"; "testimonial"; "Saturday"; "warning_card"; "Sunday"; "quote_card")}}
```

### Resolved weekly rhythm

| Day | `content_type` | `image_template` |
| --- | --- | --- |
| Monday | `service_spotlight` | `service_card` |
| Tuesday | `trust_stat` | `stat_card` |
| Wednesday | `nyc_code_tip` | `cheatsheet` |
| Thursday | `project_showcase` | `project_card` |
| Friday | `customer_testimonial` | `testimonial` |
| Saturday | `pro_tip_warning` | `warning_card` |
| Sunday | `brand_insight` | `quote_card` |

Note: there is **no `default` branch** in either `switch()`. `formatDate(now; "dddd")` is
evaluated in the scenario's inherited timezone, so the day boundary follows that zone,
not the customer's New York zone.

---

## 4. Module 3 — `openai-gpt-3:CreateCompletion`

Designer position `x: 600, y: 0`.

| Setting | Value |
| --- | --- |
| `select` | `chat` |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `2500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| `__IMTCONN__` | `[REDACTED]` (restore label: `Pioneer OpenAI`, scoped connection `openai-gpt-3`) |

No `frequency_penalty`, `presence_penalty`, `stop`, `seed` or `logit_bias` is set.
No `onerror` handler and no retry directive on this module.

### COMPLETE system prompt (verbatim)

Mapping tokens `{{2.day_of_week}}`, `{{2.content_type}}`, `{{2.image_template}}` are
Make references to module 2. The line reading `- \n\n between …` contains **literal
backslash-n characters**, not real newlines — that is exactly how it appears in Make.

```text
You are the Marketing Lead for Makkah Roofing Contractor NYC, a licensed and insured roofing company in NYC serving all 5 boroughs plus Westchester.

BUSINESS:
- Phone: (917) 450-5719
- Email: [REDACTED]
- Website: https://roofingcontractor-nyc.com/
- Address: 12115 103rd Avenue, Queens, NY 11419
- Service areas: Manhattan, Brooklyn, Queens, Bronx, Staten Island + Yonkers, Mount Vernon, New Rochelle, White Plains, Westchester
- 24/7 Emergency roof help available

SERVICES: Roof Installation, Flat & Shingle Roofs, Roof Repair & Leaks, EPDM/TPO/Torch Down Roofing, Roof Coating & Waterproofing, Roof Inspection & Maintenance, Skylight & Gutter Work, Emergency Roofing.

RULES:
- First-person as Makkah Roofing Contractor NYC
- NO emojis, no fancy symbols
- Plain numbered lists (1. 2. 3.)
- \n\n between every paragraph and every list item
- Each post ends with phone, email, website on separate lines
- 4-7 NYC-relevant hashtags at end
- NYC-specific (boroughs, weather, permits, building codes)
- NO double quotes inside text values

You MUST output valid JSON with image_data fields FILLED with real content for today's template. No placeholders, no dots, no empty strings for the active template.

TODAY: {{2.day_of_week}} | Content type: {{2.content_type}} | Template: {{2.image_template}}

For template = service_card: fill service_name, service_subtitle, problem_text, solution_text, result_text, tags (array of 3 like 'Flat Roofs', 'Shingles', 'Repairs').

For template = stat_card: fill big_stat (e.g. 24/7, 5, 100), stat_label, overline (1-2 words), badges (array of 3 like LICENSED/INSURED/24-7).

For template = cheatsheet: fill title_line1, title_line2 (highlighted), category_tag, tips (5 short), tip_subtitles (5 short).

For template = project_card: fill project_type, project_location, detail_1, detail_2, detail_3, timeline, result_highlight.

For template = testimonial: fill review_quote (12-18 words customer voice), review_subtitle, client_name (e.g. 'Sam D.'), client_location (e.g. 'Bronx'), client_initials (2 letters).

For template = warning_card: fill warning_title, highlight_word, mistake_description, consequence, solution_text_warning, pro_tip.

For template = quote_card: fill quote_part1, quote_part2 (highlighted), subquote, category_tag.

For OTHER templates' fields, use empty string "".

Keep image text SHORT (poster format). Real values only, no placeholder text.

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

### COMPLETE user prompt (verbatim)

```text
Generate today's post for Makkah Roofing Contractor NYC.

Day: {{2.day_of_week}}
Content type: {{2.content_type}}
Template: {{2.image_template}}

Make it fresh, NYC-specific, about roofing. Fill the image_data fields for template {{2.image_template}} with REAL short text (no placeholders, no dots).

Return JSON only.
```

---

## 5. Exact JSON output schema demanded by the prompt

Top level — 5 keys:

| Field | Constraint as stated in the prompt |
| --- | --- |
| `topic` | `"3-5 word topic"` |
| `service_focus` | `"which service"` |
| `facebook_post` | `"180-280 words with proper formatting and contact info"` |
| `linkedin_post` | `"250-350 words professional B2B with contact info"` |
| `image_data` | object, 36 keys (below) |

`image_data` — 36 fields. All are emitted every run; only the fields belonging to
today's template are to be filled, the rest returned as `""`.

| Field | Type | Belongs to template | Constraint stated |
| --- | --- | --- | --- |
| `service_name` | string | `service_card` | — |
| `service_subtitle` | string | `service_card` | — |
| `problem_text` | string | `service_card` | — |
| `solution_text` | string | `service_card` | — |
| `result_text` | string | `service_card` | — |
| `tags` | array | `service_card` | array of 3, e.g. 'Flat Roofs', 'Shingles', 'Repairs' |
| `big_stat` | string | `stat_card` | e.g. 24/7, 5, 100 |
| `stat_label` | string | `stat_card` | — |
| `overline` | string | `stat_card` | 1-2 words |
| `badges` | array | `stat_card` | array of 3, e.g. LICENSED / INSURED / 24-7 |
| `title_line1` | string | `cheatsheet` | — |
| `title_line2` | string | `cheatsheet` | highlighted line |
| `category_tag` | string | `cheatsheet`, `quote_card` | shared by two templates |
| `tips` | array | `cheatsheet` | 5 short |
| `tip_subtitles` | array | `cheatsheet` | 5 short |
| `project_type` | string | `project_card` | — |
| `project_location` | string | `project_card` | — |
| `detail_1` | string | `project_card` | — |
| `detail_2` | string | `project_card` | — |
| `detail_3` | string | `project_card` | — |
| `timeline` | string | `project_card` | — |
| `result_highlight` | string | `project_card` | — |
| `review_quote` | string | `testimonial` | 12-18 words, customer voice |
| `review_subtitle` | string | `testimonial` | — |
| `client_name` | string | `testimonial` | e.g. 'Sam D.' |
| `client_location` | string | `testimonial` | e.g. 'Bronx' |
| `client_initials` | string | `testimonial` | 2 letters |
| `warning_title` | string | `warning_card` | — |
| `highlight_word` | string | `warning_card` | — |
| `mistake_description` | string | `warning_card` | — |
| `consequence` | string | `warning_card` | — |
| `solution_text_warning` | string | `warning_card` | — |
| `pro_tip` | string | `warning_card` | — |
| `quote_part1` | string | `quote_card` | — |
| `quote_part2` | string | `quote_card` | highlighted |
| `subquote` | string | `quote_card` | — |

Global constraints on all image text: "Keep image text SHORT (poster format)", "Real
values only, no placeholder text", "NO double quotes inside text values".

Note a schema quirk worth preserving or fixing on migration: `category_tag` is listed
under both `cheatsheet` and `quote_card`, and there is **no Instagram or Threads field** —
only `facebook_post` and `linkedin_post`.

---

## 6. Module 4 — `util:SetVariables` (templates + CSS)

Designer position `x: 900, y: 0`. `scope: "roundtrip"`. Eight variables: seven HTML
templates plus one shared stylesheet. Every dynamic slot is wrapped in
`ifempty(<path>; "<hardcoded fallback>")`, so each template still renders complete,
business-specific copy if the model returns an empty string.

### `tpl_service` (verbatim)

```html
<div class='card dark-card'><div class='gold-top-bar'></div><div class='grid-bg'></div><div class='gold-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>ROOFING CONTRACTORS NYC</span></div><div class='badge-gold-border'>★ SERVICE</div></div><div class='title-block'><div class='overline-row'><div class='gold-bar'></div><span class='overline-gold'>EXPERT ROOFING</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.service_name; "Roof Repair")}}<br><span class='gold-highlight'>{{ifempty(3.result.image_data.service_subtitle; "and Installation")}}</span></h1></div><div class='service-blocks'><div class='block-left-gold'><div class='block-label'>THE PROBLEM</div><div class='block-text'>{{ifempty(3.result.image_data.problem_text; "Leaking roofs damage your property fast")}}</div></div><div class='block-left-gold'><div class='block-label'>OUR SOLUTION</div><div class='block-text'>{{ifempty(3.result.image_data.solution_text; "Fast professional repair and waterproofing")}}</div></div><div class='block-left-gold'><div class='block-label'>THE RESULT</div><div class='block-text'>{{ifempty(3.result.image_data.result_text; "Strong roof that lasts decades")}}</div></div><div class='tag-row'><div class='tag-gold'>● {{ifempty(get(3.result.image_data.tags; 1); "Flat Roofs")}}</div><div class='tag-gold'>● {{ifempty(get(3.result.image_data.tags; 2); "Shingles")}}</div><div class='tag-gold'>● {{ifempty(get(3.result.image_data.tags; 3); "Repairs")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>24/7 emergency roof service</span><span class='footer-gold-strong'>(917) 450-5719</span></div></div>
```

### `tpl_stat` (verbatim)

```html
<div class='card dark-card'><div class='gold-top-bar'></div><div class='grid-bg'></div><div class='gold-orb-top'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>ROOFING CONTRACTORS NYC</span></div><div class='badge-gold-border'>LICENSED & INSURED</div></div><div class='stat-body'><div class='overline-row'><div class='gold-bar'></div><span class='overline-gold'>{{ifempty(3.result.image_data.overline; "AVAILABILITY")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.big_stat; "24")}}<span class='gold-suffix'>/7</span></div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "Emergency roofing across all NYC boroughs day or night")}}</div><div class='badge-row'><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 1); "LICENSED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 2); "INSURED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 3); "24-7")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>(917) 450-5719</span><span class='footer-gold-strong'>roofingcontractor-nyc.com →</span></div></div>
```

### `tpl_cheat` (verbatim)

```html
<div class='card light-card'><div class='gold-top-bar'></div><div class='light-orb'></div><div class='header light-header-style'><div class='logo-group'><span class='brand-makkah-dark'>Makkah</span><span class='brand-sub-gold'>ROOFING CONTRACTORS NYC</span></div><div class='badge-gold-solid'>▲ {{ifempty(3.result.image_data.category_tag; "NYC TIPS")}}</div></div><div class='title-block'><div class='overline-row'><div class='gold-bar'></div><span class='overline-gold-light'>ROOFING GUIDE</span></div><h1 class='cheat-title-dark'>{{ifempty(3.result.image_data.title_line1; "5 signs your roof")}}<br><span class='gold-highlight'>{{ifempty(3.result.image_data.title_line2; "needs attention")}}</span></h1></div><div class='tip-list-light'><div class='tip-card-light'><div class='tip-num-black'>01</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 1); "Missing or cracked shingles")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "Replace before water gets in")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>02</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 2); "Water stains on ceiling")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "Hidden leak getting worse fast")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>03</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 3); "Sagging roof sections")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "Structural problem needs urgent care")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>04</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 4); "Granules in gutters")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "Sign roof is wearing out")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>05</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 5); "Roof over 20 years old")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "Time for full inspection")}}</span></div></div></div><div class='card-footer light-footer-style'><span class='footer-gray'>Call (917) 450-5719</span><span class='footer-gold-strong'>roofingcontractor-nyc.com →</span></div></div>
```

### `tpl_project` (verbatim — footer email redacted)

The footer `<span class='footer-light-text'>` contains the business contact email in the
live blueprint; it is shown as `[REDACTED]` here.

```html
<div class='card dark-card'><div class='gold-top-bar'></div><div class='grid-bg'></div><div class='gold-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>ROOFING CONTRACTORS NYC</span></div><div class='badge-gold-border'>◆ PROJECT</div></div><div class='title-block'><div class='overline-row'><div class='gold-bar'></div><span class='overline-gold'>RECENT WORK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.project_type; "Flat Roof Replacement")}}<br><span class='gold-highlight'>{{ifempty(3.result.image_data.project_location; "Brooklyn")}}</span></h1></div><div class='project-details'><div class='detail-row'><div class='detail-icon-gold'>01</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_1; "Full tear-off and rebuild")}}</div></div><div class='detail-row'><div class='detail-icon-gold'>02</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_2; "EPDM rubber roofing install")}}</div></div><div class='detail-row'><div class='detail-icon-gold'>03</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_3; "Full waterproofing system")}}</div></div><div class='project-stats'><div class='stat-block'><div class='stat-block-label'>TIMELINE</div><div class='stat-block-value'>{{ifempty(3.result.image_data.timeline; "3 days")}}</div></div><div class='stat-block-divider'></div><div class='stat-block'><div class='stat-block-label'>RESULT</div><div class='stat-block-value'>{{ifempty(3.result.image_data.result_highlight; "Leak-free 25 years")}}</div></div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>[REDACTED]</span><span class='footer-gold-strong'>(917) 450-5719</span></div></div>
```

### `tpl_testimonial` (verbatim)

```html
<div class='card gold-card'><div class='grid-bg-light'></div><div class='quote-deco-bg'>&ldquo;</div><div class='dark-orb-bottom'></div><div class='header'><div class='logo-group'><span class='brand-makkah-on-gold'>Makkah</span><span class='brand-sub-white'>ROOFING CONTRACTORS NYC</span></div><div class='badge-glass'>★ 5-STAR REVIEW</div></div><div class='quote-body'><div class='stars-row'><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span></div><div class='testimonial-text'>{{ifempty(3.result.image_data.review_quote; "They came the same day and fixed our leak. No mess left.")}}</div><div class='testimonial-sub'>{{ifempty(3.result.image_data.review_subtitle; "Fast, clean and professional roofing service.")}}</div></div><div class='card-footer gold-card-footer'><div class='author-block'><div class='author-circle'>{{ifempty(3.result.image_data.client_initials; "SD")}}</div><div class='author-info'><div class='author-name'>{{ifempty(3.result.image_data.client_name; "Sam D.")}}</div><div class='author-role'>{{ifempty(3.result.image_data.client_location; "Bronx")}}</div></div></div><span class='url-light'>roofingcontractor-nyc.com</span></div></div>
```

### `tpl_warning` (verbatim)

```html
<div class='card dark-card'><div class='gold-top-bar-thick'></div><div class='grid-bg'></div><div class='gold-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>ROOFING CONTRACTORS NYC</span></div><div class='badge-warning'>⚠ WARNING</div></div><div class='title-block'><div class='overline-row'><div class='gold-bar'></div><span class='overline-gold'>COMMON MISTAKE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.warning_title; "Do not ignore")}}<br><span class='gold-highlight'>{{ifempty(3.result.image_data.highlight_word; "small leaks")}}</span></h1></div><div class='warning-blocks'><div class='warn-block'><div class='warn-label-gold'>THE MISTAKE</div><div class='warn-text'>{{ifempty(3.result.image_data.mistake_description; "Ignoring tiny roof leaks until they spread")}}</div></div><div class='warn-block consequence-block'><div class='warn-label-gold'>CONSEQUENCE</div><div class='warn-text'>{{ifempty(3.result.image_data.consequence; "Major water damage, mold, structural problems")}}</div></div><div class='warn-block solution-block'><div class='warn-label-green'>DO THIS INSTEAD</div><div class='warn-text-white'>{{ifempty(3.result.image_data.solution_text_warning; "Call us at first sign of any leak")}}</div></div><div class='pro-tip-bar'><span class='pro-tip-label'>PRO TIP:</span> {{ifempty(3.result.image_data.pro_tip; "Inspect roof twice a year and after every storm")}}</div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Avoid costly mistakes</span><span class='footer-gold-strong'>(917) 450-5719</span></div></div>
```

### `tpl_quote` (verbatim)

```html
<div class='card black-quote-card'><div class='grid-bg'></div><div class='gold-side-bar'></div><div class='gold-orb-large'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>ROOFING CONTRACTORS NYC</span></div><div class='badge-gold-border'>✦ {{ifempty(3.result.image_data.category_tag; "OUR PROMISE")}}</div></div><div class='quote-block-center'><div class='gold-accent-bar'></div><div class='overline-gold-quote'>OUR APPROACH</div><div class='quote-mega-text'>{{ifempty(3.result.image_data.quote_part1; "A strong roof is")}} <span class='gold-highlight'>{{ifempty(3.result.image_data.quote_part2; "peace of mind")}}</span></div><div class='quote-sub-text'>{{ifempty(3.result.image_data.subquote; "We protect NYC homes and businesses 24/7 with quality roofing.")}}</div></div><div class='card-footer dark-footer'><div class='since-block'><div class='since-number'>24/7</div><div class='since-text'>EMERGENCY<br>ROOF HELP</div></div><div class='contact-stack'><span class='contact-line'>(917) 450-5719</span><span class='contact-line-gold'>roofingcontractor-nyc.com</span></div></div></div>
```

### `shared_css` (verbatim, single stylesheet for all seven templates)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.dark-card{background:linear-gradient(135deg,#0A1628 0%,#142342 50%,#0A1628 100%);color:white}.light-card{background:#FAFAF5;color:#0A1628;gap:32px;justify-content:flex-start}.gold-card{background:linear-gradient(135deg,#F4B942 0%,#E8A317 50%,#C8870A 100%);color:#0A1628}.black-quote-card{background:#0A1628;color:white;justify-content:center}.gold-top-bar{position:absolute;top:0;left:0;width:100%;height:12px;background:#F4B942;z-index:5}.gold-top-bar-thick{position:absolute;top:0;left:0;width:100%;height:16px;background:#F4B942;z-index:5}.gold-side-bar{position:absolute;top:0;left:0;width:12px;height:100%;background:#F4B942;z-index:5}.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(244,185,66,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(244,185,66,0.07) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.grid-bg-light{position:absolute;inset:0;background-image:linear-gradient(rgba(10,22,40,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(10,22,40,0.05) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.gold-orb{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(244,185,66,0.22) 0%,transparent 70%);pointer-events:none;z-index:1}.gold-orb-top{position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(244,185,66,0.28) 0%,transparent 70%);pointer-events:none;z-index:1}.gold-orb-large{position:absolute;bottom:-300px;right:-300px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(244,185,66,0.18) 0%,transparent 70%);pointer-events:none;z-index:1}.light-orb{position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:rgba(244,185,66,0.1);pointer-events:none;z-index:1}.dark-orb-bottom{position:absolute;bottom:-300px;left:-300px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(10,22,40,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.quote-deco-bg{position:absolute;top:60px;right:60px;font-size:500px;line-height:0.6;opacity:0.12;font-family:Georgia,serif;font-weight:900;color:#0A1628;pointer-events:none;z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3;padding-top:8px}.light-header-style{padding-bottom:28px;border-bottom:3px solid #E5E5DD}.logo-group{display:flex;flex-direction:column;gap:4px}.brand-makkah{font-size:54px;font-weight:700;letter-spacing:2px;color:#F4B942;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-makkah-dark{font-size:54px;font-weight:700;letter-spacing:2px;color:#0A1628;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-makkah-on-gold{font-size:54px;font-weight:700;letter-spacing:2px;color:#0A1628;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-sub{font-size:14px;font-weight:600;letter-spacing:4px;color:#FCD9A6}.brand-sub-gold{font-size:14px;font-weight:600;letter-spacing:4px;color:#C8870A}.brand-sub-white{font-size:14px;font-weight:600;letter-spacing:4px;color:rgba(10,22,40,0.85)}.badge-gold-border{background:rgba(244,185,66,0.15);border:2px solid #F4B942;padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-gold-solid{background:#F4B942;padding:11px 22px;font-size:16px;color:#0A1628;font-weight:800;letter-spacing:2.5px}.badge-warning{background:#F4B942;padding:11px 22px;font-size:16px;color:#0A1628;font-weight:800;letter-spacing:2.5px}.badge-glass{background:rgba(10,22,40,0.25);border:2px solid rgba(10,22,40,0.3);padding:10px 22px;font-size:16px;color:#0A1628;font-weight:800;letter-spacing:2.5px}.title-block{position:relative;z-index:3}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}.gold-bar{width:36px;height:6px;background:#F4B942}.overline-gold{font-size:20px;color:#FCD9A6;font-weight:900;letter-spacing:4px}.overline-gold-light{font-size:20px;color:#C8870A;font-weight:900;letter-spacing:4px}.overline-gold-quote{font-size:24px;color:#FCD9A6;font-weight:900;letter-spacing:5px;margin-bottom:24px}.service-title{font-size:80px;font-weight:900;color:white;line-height:1.05;letter-spacing:-2.5px}.cheat-title-dark{font-size:80px;font-weight:900;color:#0A1628;line-height:1.05;letter-spacing:-2.5px}.gold-highlight{color:#F4B942}.service-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.block-left-gold{background:rgba(255,255,255,0.05);border-left:6px solid #F4B942;padding:22px 28px}.block-label{font-size:18px;color:#FCD9A6;font-weight:900;letter-spacing:3px;margin-bottom:8px}.block-text{font-size:28px;color:white;font-weight:700;line-height:1.35}.tag-row{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.tag-gold{background:rgba(244,185,66,0.18);padding:10px 20px;font-size:18px;color:white;font-weight:700;letter-spacing:0.5px}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.mega-stat{font-size:340px;font-weight:900;color:white;line-height:0.95;letter-spacing:-14px;margin-bottom:16px}.gold-suffix{color:#F4B942}.stat-desc{font-size:40px;color:#CBD5E1;line-height:1.3;font-weight:500;max-width:900px}.badge-row{display:flex;gap:16px;margin-top:36px;flex-wrap:wrap}.trust-badge{background:rgba(244,185,66,0.15);border-left:6px solid #F4B942;padding:14px 24px;font-size:20px;color:white;font-weight:900;letter-spacing:2px}.tip-list-light{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card-light{background:white;border-left:8px solid #F4B942;padding:20px 26px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)}.tip-num-black{background:#0A1628;color:#F4B942;min-width:62px;height:62px;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main-dark{font-size:28px;color:#0A1628;font-weight:900;line-height:1.25}.tip-sub-dark{font-size:18px;color:#64748B;font-weight:500;line-height:1.3}.project-details{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.detail-row{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,0.04);border-left:6px solid #F4B942;padding:20px 26px}.detail-icon-gold{background:#F4B942;color:#0A1628;min-width:56px;height:56px;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center}.detail-text{font-size:26px;color:white;font-weight:600;line-height:1.3}.project-stats{display:flex;align-items:center;gap:32px;margin-top:8px;background:rgba(244,185,66,0.12);border:2px solid rgba(244,185,66,0.4);padding:24px 32px}.stat-block{flex:1}.stat-block-label{font-size:16px;color:#FCD9A6;font-weight:900;letter-spacing:3px;margin-bottom:6px}.stat-block-value{font-size:30px;color:white;font-weight:900;line-height:1.2}.stat-block-divider{width:2px;height:60px;background:rgba(244,185,66,0.4)}.stars-row{display:flex;gap:6px;margin-bottom:20px}.star{color:#0A1628;font-size:48px;font-weight:900}.testimonial-text{font-size:54px;font-weight:900;line-height:1.2;letter-spacing:-1.5px;color:#0A1628}.testimonial-sub{font-size:24px;opacity:0.85;margin-top:18px;font-weight:500;line-height:1.4;color:#0A1628}.author-block{display:flex;align-items:center;gap:18px}.author-circle{width:60px;height:60px;border-radius:50%;background:rgba(10,22,40,0.25);border:2px solid rgba(10,22,40,0.4);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:#0A1628}.author-info{display:flex;flex-direction:column}.author-name{font-size:22px;font-weight:900;color:#0A1628}.author-role{font-size:18px;opacity:0.8;color:#0A1628;font-weight:500}.warning-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.warn-block{background:rgba(255,255,255,0.05);border-left:6px solid #F4B942;padding:22px 28px}.consequence-block{background:rgba(244,185,66,0.15);border-left:6px solid #F4B942}.solution-block{background:rgba(34,197,94,0.12);border-left:6px solid #22C55E}.warn-label-gold{font-size:18px;color:#FCD9A6;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-label-green{font-size:18px;color:#4ADE80;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-text{font-size:26px;color:white;font-weight:700;line-height:1.35}.warn-text-white{font-size:26px;color:white;font-weight:700;line-height:1.35}.pro-tip-bar{background:rgba(244,185,66,0.2);padding:18px 24px;font-size:22px;color:white;font-weight:600;line-height:1.4;border:2px solid rgba(244,185,66,0.5);margin-top:8px}.pro-tip-label{color:#FCD9A6;font-weight:900;letter-spacing:2px;margin-right:8px}.quote-block-center{position:relative;z-index:3;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:880px}.gold-accent-bar{height:8px;width:80px;background:#F4B942;margin-bottom:24px}.quote-mega-text{font-size:96px;font-weight:900;line-height:1.05;letter-spacing:-3px;color:white;margin-bottom:28px}.quote-sub-text{font-size:32px;color:#CBD5E1;line-height:1.4;font-weight:500;max-width:780px}.since-block{display:flex;align-items:center;gap:14px}.since-number{font-size:70px;font-weight:900;color:#F4B942;line-height:1}.since-text{font-size:14px;font-weight:900;color:white;letter-spacing:2.5px;line-height:1.3}.contact-stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.contact-line{font-size:22px;color:white;font-weight:700;letter-spacing:1px}.contact-line-gold{font-size:18px;color:#FCD9A6;font-weight:700;letter-spacing:0.5px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;position:relative;z-index:3}.dark-footer{border-top:2px solid rgba(244,185,66,0.4)}.light-footer-style{border-top:3px solid #E5E5DD}.gold-card-footer{border-top:2px solid rgba(10,22,40,0.3)}.footer-light-text{font-size:20px;color:#94A3B8;letter-spacing:1px;font-weight:600}.footer-gold-strong{font-size:22px;color:#F4B942;font-weight:900;letter-spacing:0.5px}.footer-gray{font-size:20px;color:#64748B;font-weight:700;letter-spacing:0.5px}.url-light{font-size:20px;color:#0A1628;opacity:0.85;letter-spacing:1.5px;font-weight:600}
```

---

## 7. Module 5 — `util:SetVariable2` (template selection)

Designer position `x: 1200, y: 0`. Variable name `final_html`, `scope: "roundtrip"`.

```
{{switch(2.image_template; "service_card"; 4.tpl_service; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "project_card"; 4.tpl_project; "testimonial"; 4.tpl_testimonial; "warning_card"; 4.tpl_warning; "quote_card"; 4.tpl_quote)}}
```

No default branch. If `image_template` were ever unmatched, `final_html` resolves empty
and module 6 renders a blank card — there is no guard against this.

---

## 8. Module 6/7 — `html-css-to-image`

### Module 6 `html-css-to-image:Image` — render settings

Designer position `x: 1500, y: 0`.

| Setting | Value |
| --- | --- |
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `device_scale` | `2` (renders at 2160×2160 physical pixels) |
| `google_fonts` | `Inter` |
| `selector` | **not set** — the whole 1080×1080 viewport is captured |
| `__IMTCONN__` | `[REDACTED]` (restore label: `Makkah Roofing Contractors HTML/CSS to Image connection`) |

No `ms_delay`, `render_when_ready` or `full_screen` parameter is set.

### Module 7 `html-css-to-image:GetImage`

Designer position `x: 1800, y: 0`.

| Setting | Value |
| --- | --- |
| `image_id` | `{{6.id}}` |
| `format` | `png` |
| `__IMTCONN__` | `[REDACTED]` (same connection as module 6) |

Outputs `{{7.image}}` (binary) and `{{7.fileName}}`, both consumed by modules 8 and 9.

### Where colour hexes, fonts, logo and business constants appear

**Colour hexes — all defined in `shared_css` only. Templates never inline a hex; they
reference class names.** Full palette:

| Hex | Role | CSS classes / properties using it |
| --- | --- | --- |
| `#0A1628` | Primary dark navy (brand ink / field) | `.dark-card` gradient stops 0% and 100%, `.light-card` color, `.gold-card` color, `.black-quote-card` background, `.brand-makkah-dark`, `.brand-makkah-on-gold`, `.quote-deco-bg`, `.badge-gold-solid`, `.badge-warning`, `.badge-glass`, `.cheat-title-dark`, `.tip-num-black` bg, `.tip-main-dark`, `.detail-icon-gold` color, `.star`, `.testimonial-text`, `.testimonial-sub`, `.author-circle`, `.author-name`, `.author-role`, `.url-light` |
| `#142342` | Mid navy | `.dark-card` gradient 50% stop |
| `#F4B942` | **Primary gold accent** | `.gold-card` gradient 0%, `.gold-top-bar`, `.gold-top-bar-thick`, `.gold-side-bar`, `.brand-makkah`, `.badge-gold-border` border, `.badge-gold-solid` bg, `.badge-warning` bg, `.gold-bar`, `.gold-highlight`, `.block-left-gold` border, `.gold-suffix`, `.trust-badge` border, `.tip-card-light` border, `.tip-num-black` color, `.detail-row` border, `.detail-icon-gold` bg, `.warn-block` border, `.consequence-block` border, `.gold-accent-bar`, `.since-number`, `.footer-gold-strong` |
| `#E8A317` | Gold mid | `.gold-card` gradient 50% |
| `#C8870A` | Gold dark | `.gold-card` gradient 100%, `.brand-sub-gold`, `.overline-gold-light` |
| `#FCD9A6` | Cream / light gold | `.brand-sub`, `.overline-gold`, `.overline-gold-quote`, `.block-label`, `.stat-block-label`, `.warn-label-gold`, `.pro-tip-label`, `.contact-line-gold` |
| `#FAFAF5` | Off-white paper | `.light-card` background |
| `#E5E5DD` | Light rule | `.light-header-style` border-bottom, `.light-footer-style` border-top |
| `#CBD5E1` | Slate light | `.stat-desc`, `.quote-sub-text` |
| `#94A3B8` | Slate mid | `.footer-light-text` |
| `#64748B` | Slate dark | `.tip-sub-dark`, `.footer-gray` |
| `#22C55E` | Green (positive) | `.solution-block` border-left |
| `#4ADE80` | Light green | `.warn-label-green` |
| `rgba(244,185,66,α)` | Gold at α = 0.07 / 0.1 / 0.12 / 0.15 / 0.18 / 0.2 / 0.22 / 0.28 / 0.4 / 0.5 | grid overlays, orbs, badge fills, tag fills, trust badge fills, project-stats panel, pro-tip bar, `.dark-footer` border |
| `rgba(10,22,40,α)` | Navy at α = 0.05 / 0.25 / 0.3 / 0.4 / 0.85 | `.grid-bg-light`, `.badge-glass`, `.dark-orb-bottom`, `.author-circle`, `.brand-sub-white`, `.gold-card-footer` border |
| `rgba(34,197,94,0.12)` | Green tint | `.solution-block` background |
| `rgba(255,255,255,0.04 / 0.05)` | White tint | `.block-left-gold`, `.warn-block`, `.detail-row` backgrounds |
| `rgba(0,0,0,0.06)` | Shadow | `.tip-card-light` box-shadow |
| `white` | Keyword | many text colours, `.tip-card-light` background |

**Font families — two only:**

- `'Inter', -apple-system, sans-serif` — global `*` rule; `Inter` is also the value of
  the module's `google_fonts` parameter, so it is loaded by the render service.
- `Georgia, serif` — the `Makkah` wordmark (`.brand-makkah`, `.brand-makkah-dark`,
  `.brand-makkah-on-gold`, all `font-style:italic`) and the giant decorative quote glyph
  (`.quote-deco-bg`).

**Logo URL — there is none.** The brand mark is pure text: the word `Makkah` in italic
Georgia plus a letter-spaced `ROOFING CONTRACTORS NYC` sub-line. No `<img>` tag, no
background-image URL, no external asset of any kind appears in any template. Every card
is fully self-contained HTML + CSS.

**Business constants inside the HTML templates:**

| Constant | Appears in |
| --- | --- |
| `Makkah` (wordmark) | all 7 templates, header |
| `ROOFING CONTRACTORS NYC` (sub-lockup) | all 7 templates, header |
| `(917) 450-5719` | `tpl_service` footer, `tpl_stat` footer, `tpl_cheat` footer (as `Call (917) 450-5719`), `tpl_project` footer, `tpl_warning` footer, `tpl_quote` footer |
| `roofingcontractor-nyc.com →` | `tpl_stat` footer, `tpl_cheat` footer |
| `roofingcontractor-nyc.com` | `tpl_testimonial` footer, `tpl_quote` footer |
| business email `[REDACTED]` | `tpl_project` footer |
| `24/7 emergency roof service` | `tpl_service` footer |
| `24/7` + `EMERGENCY ROOF HELP` | `tpl_quote` footer |
| `Avoid costly mistakes` | `tpl_warning` footer |
| `LICENSED & INSURED` badge | `tpl_stat` header |

**Static label / badge copy baked into the templates (not model-generated):**
`★ SERVICE`, `◆ PROJECT`, `⚠ WARNING`, `★ 5-STAR REVIEW`, `LICENSED & INSURED`,
`▲ {category_tag}`, `✦ {category_tag}`, `EXPERT ROOFING`, `ROOFING GUIDE`,
`RECENT WORK`, `COMMON MISTAKE`, `OUR APPROACH`, `THE PROBLEM`, `OUR SOLUTION`,
`THE RESULT`, `THE MISTAKE`, `CONSEQUENCE`, `DO THIS INSTEAD`, `PRO TIP:`,
`TIMELINE`, `RESULT`, the numerals `01`–`05`, and five `★` glyphs.

---

## 9. Business constants (complete inventory)

| Constant | Value | Source |
| --- | --- | --- |
| Business name | `Makkah Roofing Contractor NYC` | system prompt, user prompt, LinkedIn `altText` |
| Wordmark / lockup | `Makkah` + `ROOFING CONTRACTORS NYC` | all HTML templates |
| Phone | `(917) 450-5719` | system prompt + 6 template footers |
| Email | `[REDACTED]` | system prompt + `tpl_project` footer |
| Website | `https://roofingcontractor-nyc.com/` (bare form `roofingcontractor-nyc.com` in templates) | system prompt + 4 template footers |
| Street address | `12115 103rd Avenue, Queens, NY 11419` | system prompt only |
| City / region | NYC, all 5 boroughs plus Westchester | system prompt |
| Service areas | `Manhattan, Brooklyn, Queens, Bronx, Staten Island + Yonkers, Mount Vernon, New Rochelle, White Plains, Westchester` | system prompt |
| Availability claim | `24/7 Emergency roof help available` | system prompt, `tpl_service`, `tpl_stat`, `tpl_quote` |
| Credential claim | `licensed and insured` / `LICENSED & INSURED` | system prompt, `tpl_stat` badge, `stat_card` default badges |
| Services list (8) | `Roof Installation`, `Flat & Shingle Roofs`, `Roof Repair & Leaks`, `EPDM/TPO/Torch Down Roofing`, `Roof Coating & Waterproofing`, `Roof Inspection & Maintenance`, `Skylight & Gutter Work`, `Emergency Roofing` | system prompt |
| CTA text | No single CTA string. Contact block is the CTA: prompt rule "Each post ends with phone, email, website on separate lines"; image CTAs are the footer strings `24/7 emergency roof service`, `Call (917) 450-5719`, `roofingcontractor-nyc.com →`, `Avoid costly mistakes` | prompt + templates |
| Hashtags | **Not hardcoded.** Prompt rule only: `4-7 NYC-relevant hashtags at end`. The model invents them each run. | system prompt |
| Brand colours | `#F4B942` (primary gold), `#0A1628` (primary navy), `#142342`, `#E8A317`, `#C8870A`, `#FCD9A6`, `#FAFAF5`, `#E5E5DD`, plus utility `#CBD5E1` `#94A3B8` `#64748B` `#22C55E` `#4ADE80` | `shared_css` |
| Fonts | `Inter` (body, via Google Fonts), `Georgia` italic (wordmark + decorative quote) | `shared_css` + `google_fonts` param |
| Logo URL | none — text-only wordmark | n/a |
| LinkedIn image alt text | `Makkah Roofing Contractor NYC insights` | module 9 |

**Hardcoded fallback copy** (the `ifempty` second arguments) is also business-specific
and must be treated as content, not scaffolding — e.g. `Roof Repair` / `and Installation`,
`Leaking roofs damage your property fast`, `Emergency roofing across all NYC boroughs day
or night`, `5 signs your roof` / `needs attention`, `Flat Roof Replacement` / `Brooklyn`,
`EPDM rubber roofing install`, `Leak-free 25 years`, `They came the same day and fixed our
leak. No mess left.`, `Sam D.` / `Bronx` / `SD`, `Do not ignore` / `small leaks`,
`A strong roof is` / `peace of mind`, `We protect NYC homes and businesses 24/7 with
quality roofing.` Full list is inline in the templates above.

---

## 10. Filters, routers, error handling, history

**None of the following exist in this scenario:**

- **Filters** — no module carries a `filter` property. Every link is unconditional.
- **Routers** — no `builtin:BasicRouter`. The flow is one straight line, 1 → 9.
- **Error handlers / retry routes** — no `onerror` array on any module, no
  `builtin:Break`, `builtin:Resume`, `builtin:Ignore`, `builtin:Rollback` or
  `builtin:Commit` directive anywhere. The only error control is the scenario-level
  `maxErrors: 3` and `dlq: false` (dead-letter queue disabled, `dlqCount: 0`).
- **History lookups** — **no Google Sheets module, no Make Data Store module, no HTTP
  call, no database read of any kind.** `usedPackages` is exactly
  `["builtin","util","openai-gpt-3","util","util","html-css-to-image","html-css-to-image","facebook-pages","linkedin"]`.
  Nothing reads what was posted before and nothing writes a record after posting.
- **Deduplication** — none. Freshness relies entirely on `temperature: 0.85` and the
  prompt instruction "Make it fresh". Two Mondays in a row can produce near-identical
  `service_spotlight` output and nothing detects it.
- **Content validation** — none. The model's JSON is piped straight into HTML with no
  length check, no profanity/claims check, no verification that the active template's
  fields were actually filled. The `ifempty` fallbacks are the only safety net, and they
  catch empty strings only, not over-long or malformed text (an over-long
  `review_quote` at `font-size:54px` will overflow the fixed 1080px card silently).

Also note `freshVariables: false` and `roundtrips: 1` — all `SetVariables` modules use
`scope: "roundtrip"`, so values persist for the single round trip of each run.

---

## 11. Publishing modules

Both publish immediately and unconditionally — there is no approval step, no draft
state and no scheduling delay between generation and publication.

### Module 8 — `facebook-pages:UploadPhoto` (v6)

Designer position `x: 2100, y: 0`.

| Setting | Value |
| --- | --- |
| `page_id` | `[REDACTED]` |
| `data` | `{{7.image}}` — the rendered PNG |
| `fileName` | `{{7.fileName}}` |
| `message` | `{{3.result.facebook_post}}` |
| `__IMTCONN__` | `[REDACTED]` (restore label: `Sajid Gondal`, scoped connection `facebook`) |

Posts the 1080×1080 card as a Page photo with the generated Facebook copy as the caption.

### Module 9 — `linkedin:CreateCompanyImagePost` (v2)

Designer position `x: 2400, y: 0`.

| Setting | Value |
| --- | --- |
| `organization` | `urn:li:organization:[REDACTED]` |
| `method` | `upload` |
| `data` | `{{7.image}}` — the same rendered PNG |
| `fileName` | `{{7.fileName}}` |
| `title` | `{{3.result.topic}}` |
| `content` | `{{3.result.linkedin_post}}` |
| `altText` | `Makkah Roofing Contractor NYC insights` (hardcoded, identical every day) |
| `visibility` | `PUBLIC` |
| `feedDistribution` | `MAIN_FEED` |
| `isReshareDisabledByAuthor` | `false` |
| `__IMTCONN__` | `[REDACTED]` (restore label: `Sajid Imran`, scoped connection `linkedin2`) |

Posts the same image to the company page with the longer B2B copy and the `topic` string
as the post title.

**Platform coverage:** Facebook Page and LinkedIn company page only. No Instagram, no
Threads, no Pinterest, no X — despite the scenario name saying "Multi-Platform". The
same single image asset is reused across both platforms with no per-platform crop or
aspect-ratio variant.

---

## 12. Migration notes

Points where this blueprint would need to become dynamic or gain a guard:

1. **Every business constant is hardcoded in three places** — the OpenAI system prompt,
   the seven HTML templates, and the LinkedIn `altText`. A tenant-aware version needs one
   source of truth feeding all three.
2. **Brand colours live only in a CSS string.** `#F4B942` and `#0A1628` are repeated
   dozens of times across `shared_css`; there are no CSS custom properties. Templating
   these per brand kit means a token layer (`--brand-accent`, `--brand-ink`, etc.)
   that does not currently exist.
3. **No logo asset pipeline.** The wordmark is Georgia italic text. Any brand with an
   actual logo file has nowhere to put it in these templates.
4. **Timezone is inherited, not declared** — day-of-week rotation can roll over at the
   wrong local moment for the customer.
5. **No history, no dedupe, no validation, no approval, no error route.** Each of these
   is a gap rather than a feature to port.
6. **Two platforms, one image.** `image_data` has no Instagram/Threads fields and there
   is no per-platform sizing.
