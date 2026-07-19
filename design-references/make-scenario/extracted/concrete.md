# Make.com scenario extraction: NYC Concrete Contractors

Reference extraction for the Cyflow Social code migration. Everything below is
copied from the live Make blueprint. Secrets and account identifiers are replaced
with the literal token `[REDACTED]`; nothing else has been altered.

**Redactions applied:** all connection ids / `__IMTCONN__` values, the Facebook
page id, the LinkedIn organization urn, and every email address (including the
business contact email, which appears inside the OpenAI system prompt and inside
the `tpl_project` footer HTML). Where an email was redacted inside
otherwise-verbatim text, a note marks the spot.

---

## 1. Scenario identity and schedule

| Field | Value |
| --- | --- |
| Name | `NYC Concrete Contractors - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9271019` |
| Team id | `[REDACTED]` |
| Active | `true` |
| Hook / webhook | `null` (no webhook; time-triggered only) |
| Folder | `null` |
| Created | `2026-05-21T11:03:39.238Z` |
| Last edit | `2026-05-25T09:50:13.787Z` |
| Next exec (at time of extraction) | `2026-07-20T09:00:00.000Z` |

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

- `interval: 900` = poll every 900 seconds (15 minutes), but the `restrict`
  window is only 60 seconds wide, so in practice it fires **once per day**.
- `days: [1,2,3,4,5,6,0]` covers **all seven days** (0 = Sunday through
  6 = Saturday). There is no weekday-only carve-out.
- Fire window: **14:00 to 14:01 local scenario time**.
- **No `timezone` key exists anywhere in the blueprint or scenario record.** The
  scenario inherits the Make organization/team timezone. Inference only: the
  stored `nextExec` of `09:00:00Z` against a `14:00` local window implies the
  org timezone is UTC+5 (Asia/Karachi). Treat that as derived, not declared.
  For migration this matters: the day-of-week rotation in module 2 resolves in
  the **org** timezone, not the business's New York timezone, so the "Monday"
  post can land on a different local day for the actual NYC business.

### Scenario-level runtime settings (verbatim)

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

### Module list (execution order)

| # | Module | Purpose |
| --- | --- | --- |
| 1 | `builtin:BasicFeeder` | Single-item feeder, fires the chain once |
| 2 | `util:SetVariables` | Day-of-week + content_type + image_template rotation |
| 3 | `openai-gpt-3:CreateCompletion` | Generates post copy + image data as JSON |
| 4 | `util:SetVariables` | Seven HTML templates + one shared CSS blob |
| 5 | `util:SetVariable2` | Picks the template matching today's `image_template` |
| 6 | `html-css-to-image:Image` | Renders the 1080x1080 PNG |
| 7 | `html-css-to-image:GetImage` | Fetches the rendered binary |
| 8 | `facebook-pages:UploadPhoto` | Publishes to Facebook Page |
| 9 | `linkedin:CreateCompanyImagePost` | Publishes to LinkedIn company page |

`usedPackages`: `builtin`, `util`, `openai-gpt-3`, `util`, `util`,
`html-css-to-image`, `html-css-to-image`, `facebook-pages`, `linkedin`.

---

## 2. Module 1 — `builtin:BasicFeeder`

```json
{ "array": "[{\"trigger\":\"start\"}]" }
```

A one-element array so the downstream chain executes exactly once per run.

---

## 3. Module 2 — `util:SetVariables` (the rhythm)

Scope: `roundtrip` (one cycle). Three variables, full values verbatim.

### `day_of_week`

```
{{formatDate(now; "dddd")}}
```

### `content_type` — the full day-of-week switch

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_spotlight"; "Tuesday"; "trust_stat"; "Wednesday"; "nyc_code_tip"; "Thursday"; "project_showcase"; "Friday"; "customer_testimonial"; "Saturday"; "pro_tip_warning"; "Sunday"; "brand_insight")}}
```

### `image_template` — the parallel template switch

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_card"; "Tuesday"; "stat_card"; "Wednesday"; "cheatsheet"; "Thursday"; "project_card"; "Friday"; "testimonial"; "Saturday"; "warning_card"; "Sunday"; "quote_card")}}
```

### Resolved rotation table

| Day | `content_type` | `image_template` |
| --- | --- | --- |
| Monday | `service_spotlight` | `service_card` |
| Tuesday | `trust_stat` | `stat_card` |
| Wednesday | `nyc_code_tip` | `cheatsheet` |
| Thursday | `project_showcase` | `project_card` |
| Friday | `customer_testimonial` | `testimonial` |
| Saturday | `pro_tip_warning` | `warning_card` |
| Sunday | `brand_insight` | `quote_card` |

There is **no fallback branch** on either switch. If `formatDate` returned an
unexpected value both variables resolve empty, module 5 produces empty HTML and
module 6 renders a blank card. No guard exists for this.

---

## 4. Module 3 — OpenAI `CreateCompletion`

### Settings

| Parameter | Value |
| --- | --- |
| `select` | `chat` (Create a Chat Completion, GPT and o1 models) |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `2500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| Connection (`__IMTCONN__`) | `[REDACTED]` (label was "Pioneer OpenAI") |

No seed, no frequency/presence penalty, no stop sequences, no tools/functions.

### COMPLETE system prompt (verbatim)

The only alteration below is the `- Email:` line, where the real address was
replaced with `[REDACTED]` per the redaction rule. Note that `\n\n` and `\\n\\n`
below are **literal backslash sequences in the prompt text**, not line breaks.

```
You are the Marketing Lead for Makkah Concrete Contractors NYC — a licensed and insured concrete contractor in New York City serving all 5 boroughs plus Westchester County.

## BUSINESS DETAILS:
- Brand: Makkah Concrete Contractors NYC
- Address: 12115 103rd Avenue, Queens, NY 11419
- Phone: (347) 577-2852
- Email: [REDACTED]
- Website: https://nycconcretecontractors.com/
- Service Areas: Manhattan, Brooklyn, Queens, Bronx, Staten Island + Westchester (New Rochelle, Yonkers, White Plains, Mount Vernon)
- Licensed and insured for NYC work

## 11 CORE SERVICES:
1. Concrete Sidewalk Repair
2. New Sidewalk Installation
3. Concrete Driveways
4. Stamped Concrete
5. Concrete Patios
6. Concrete Steps
7. Foundations and Slabs
8. Commercial Concrete
9. Sidewalk Violation Removal
10. Curb and Gutter Work
11. Parking Lots and Pads

## CORE RULES:
1. First-person as Makkah Concrete Contractors ('We pour', 'Our crew')
2. End EVERY post with phone, email, website
3. NYC-specific (boroughs, DOT, DOB)
4. Specific concrete numbers (4-inch, 28-day cure, PSI)
5. Rotate across services
6. NO double quotes inside text values

## TONE RULES (CRITICAL):
- NO EMOJIS in post text
- No fancy symbols
- Plain numbered lists (1. 2. 3.)
- Practical, friendly contractor voice

## FORMATTING (CRITICAL):
- \n\n between EVERY paragraph and EVERY list item
- Each paragraph: 1-3 short sentences max

CONTENT TYPE: {{2.content_type}}
IMAGE TEMPLATE: {{2.image_template}}

## IMAGE DATA (KEEP TEXT SHORT - it's a poster):

### service_card: service_name (3 words), service_subtitle (4 words), problem_text (8 words), solution_text (8 words), result_text (8 words), tags (3 tags, 2 words each)

### stat_card: big_stat (4 chars), stat_label (12 words), overline (2 words), badges (3 badges, 1 word each)

### cheatsheet: title_line1 (5 words), title_line2 (3 words, highlighted), category_tag (3 words), tips (5 tips, 4 words each), tip_subtitles (5 subtitles, 7 words each)

### project_card: project_type (3 words), project_location (3 words), detail_1 (5 words), detail_2 (5 words), detail_3 (5 words), timeline (3 words), result_highlight (5 words)

### testimonial: review_quote (18 words), review_subtitle (12 words), client_name (3 words), client_location (3 words), client_initials (2 letters)

### warning_card: warning_title (5 words), highlight_word (2 words), mistake_description (12 words), consequence (10 words), solution_text_warning (12 words), pro_tip (12 words)

### quote_card: quote_part1 (5 words), quote_part2 (5 words, highlighted), subquote (15 words), category_tag (3 words)

OUTPUT (JSON only):
{
  "topic": "3-5 word topic",
  "service_focus": "...",
  "facebook_post": "180-280 words. NO EMOJIS. \\n\\n between paragraphs. Include phone, email, website. End with 4-5 hashtags.",
  "linkedin_post": "250-350 words. NO EMOJIS. \\n\\n between paragraphs. Professional B2B tone. Include phone, email, website. End with 5-7 hashtags.",
  "image_data": {
    "service_name": "...", "service_subtitle": "...", "problem_text": "...", "solution_text": "...", "result_text": "...", "tags": ["3 tags"],
    "big_stat": "...", "stat_label": "...", "overline": "...", "badges": ["3 badges"],
    "title_line1": "...", "title_line2": "...", "category_tag": "...", "tips": ["5 tips"], "tip_subtitles": ["5 subtitles"],
    "project_type": "...", "project_location": "...", "detail_1": "...", "detail_2": "...", "detail_3": "...", "timeline": "...", "result_highlight": "...",
    "review_quote": "...", "review_subtitle": "...", "client_name": "...", "client_location": "...", "client_initials": "...",
    "warning_title": "...", "highlight_word": "...", "mistake_description": "...", "consequence": "...", "solution_text_warning": "...", "pro_tip": "...",
    "quote_part1": "...", "quote_part2": "...", "subquote": "..."
  }
}

Only fill image_data fields matching today's template.
```

### COMPLETE user prompt (verbatim)

```
Today is {{2.day_of_week}}. Content type: {{2.content_type}}. Image template: {{2.image_template}}.

Write a fresh post about Makkah Concrete Contractors NYC. Local, practical, NYC-specific.

For image_data: KEEP TEXT VERY SHORT.

Generate JSON now.
```

---

## 5. The JSON output schema the prompt demands

Top level:

| Field | Type | Constraint stated in prompt |
| --- | --- | --- |
| `topic` | string | 3-5 word topic |
| `service_focus` | string | no explicit constraint |
| `facebook_post` | string | 180-280 words, no emojis, `\n\n` between paragraphs, must include phone + email + website, ends with 4-5 hashtags |
| `linkedin_post` | string | 250-350 words, no emojis, `\n\n` between paragraphs, professional B2B tone, must include phone + email + website, ends with 5-7 hashtags |
| `image_data` | object | only the fields for today's template are filled |

`image_data` per template, with the per-field word/character budgets exactly as
the prompt states them:

**service_card**
- `service_name` — 3 words
- `service_subtitle` — 4 words
- `problem_text` — 8 words
- `solution_text` — 8 words
- `result_text` — 8 words
- `tags` — array of 3 tags, 2 words each

**stat_card**
- `big_stat` — 4 characters
- `stat_label` — 12 words
- `overline` — 2 words
- `badges` — array of 3 badges, 1 word each

**cheatsheet**
- `title_line1` — 5 words
- `title_line2` — 3 words, highlighted
- `category_tag` — 3 words
- `tips` — array of 5 tips, 4 words each
- `tip_subtitles` — array of 5 subtitles, 7 words each

**project_card**
- `project_type` — 3 words
- `project_location` — 3 words
- `detail_1` — 5 words
- `detail_2` — 5 words
- `detail_3` — 5 words
- `timeline` — 3 words
- `result_highlight` — 5 words

**testimonial**
- `review_quote` — 18 words
- `review_subtitle` — 12 words
- `client_name` — 3 words
- `client_location` — 3 words
- `client_initials` — 2 letters

**warning_card**
- `warning_title` — 5 words
- `highlight_word` — 2 words
- `mistake_description` — 12 words
- `consequence` — 10 words
- `solution_text_warning` — 12 words
- `pro_tip` — 12 words

**quote_card**
- `quote_part1` — 5 words
- `quote_part2` — 5 words, highlighted
- `subquote` — 15 words
- `category_tag` — 3 words (listed under quote_card as well as cheatsheet)

Global content constraint that shapes the schema: rule 6 of CORE RULES,
`NO double quotes inside text values` — a hand-rolled guard against breaking the
JSON, since the templates interpolate these strings straight into HTML
attributes and text nodes.

---

## 6. Module 4 — `util:SetVariables` (seven HTML templates + shared CSS)

Scope: `roundtrip`. Eight variables. Every template is a single-line HTML string
using single-quoted class attributes (so it can be embedded in the Make JSON).
Interpolation is always `{{ifempty(3.result.image_data.<field>; "<fallback>")}}`,
so every AI field has an explicit empty-string or literal fallback.

### `tpl_service` (Monday, service_card)

```html
<div class='card dark-card'><div class='blue-top-bar'></div><div class='grid-bg'></div><div class='blue-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-blue-border'>★ SERVICE</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>EXPERT CONCRETE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.service_name; "")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.service_subtitle; "")}}</span></h1></div><div class='service-blocks'><div class='block-left-blue'><div class='block-label'>THE PROBLEM</div><div class='block-text'>{{ifempty(3.result.image_data.problem_text; "")}}</div></div><div class='block-left-blue'><div class='block-label'>OUR SOLUTION</div><div class='block-text'>{{ifempty(3.result.image_data.solution_text; "")}}</div></div><div class='block-left-blue'><div class='block-label'>THE RESULT</div><div class='block-text'>{{ifempty(3.result.image_data.result_text; "")}}</div></div><div class='tag-row'><div class='tag-blue'>● {{ifempty(get(3.result.image_data.tags; 1); "Sidewalks")}}</div><div class='tag-blue'>● {{ifempty(get(3.result.image_data.tags; 2); "Driveways")}}</div><div class='tag-blue'>● {{ifempty(get(3.result.image_data.tags; 3); "Patios")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Serving NYC and Westchester</span><span class='footer-blue-strong'>(347) 577-2852</span></div></div>
```

Hardcoded in this template: brand wordmark `Makkah` + `CONCRETE CONTRACTORS NYC`,
badge `★ SERVICE`, overline `EXPERT CONCRETE`, block labels
`THE PROBLEM` / `OUR SOLUTION` / `THE RESULT`, tag fallbacks
`Sidewalks` / `Driveways` / `Patios`, footer `Serving NYC and Westchester`,
phone `(347) 577-2852`.

### `tpl_stat` (Tuesday, stat_card)

```html
<div class='card dark-card'><div class='blue-top-bar'></div><div class='grid-bg'></div><div class='blue-orb-top'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-blue-border'>LICENSED & INSURED</div></div><div class='stat-body'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>{{ifempty(3.result.image_data.overline; "NYC STANDARD")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.big_stat; "4")}}<span class='blue-suffix'>"</span></div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "")}}</div><div class='badge-row'><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 1); "LICENSED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 2); "INSURED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 3); "DOT")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>(347) 577-2852</span><span class='footer-blue-strong'>nycconcretecontractors.com →</span></div></div>
```

Hardcoded: badge `LICENSED & INSURED`, overline fallback `NYC STANDARD`,
`big_stat` fallback `4` followed by a **hardcoded inch mark** `"` in
`.blue-suffix` (so the stat is always rendered as inches regardless of what the
model returns), badge fallbacks `LICENSED` / `INSURED` / `DOT`, phone, website
`nycconcretecontractors.com →`.

### `tpl_cheat` (Wednesday, cheatsheet)

```html
<div class='card light-card'><div class='blue-top-bar'></div><div class='light-orb'></div><div class='header light-header-style'><div class='logo-group'><span class='brand-makkah-dark'>Makkah</span><span class='brand-sub-blue'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-blue-solid'>▲ {{ifempty(3.result.image_data.category_tag; "NYC TIPS")}}</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue-light'>NYC CONCRETE GUIDE</span></div><h1 class='cheat-title-dark'>{{ifempty(3.result.image_data.title_line1; "")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.title_line2; "")}}</span></h1></div><div class='tip-list-light'><div class='tip-card-light'><div class='tip-num-black'>01</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 1); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>02</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 2); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>03</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 3); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>04</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 4); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>05</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 5); "")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "")}}</span></div></div></div><div class='card-footer light-footer-style'><span class='footer-gray'>Call (347) 577-2852</span><span class='footer-blue-strong'>nycconcretecontractors.com →</span></div></div>
```

Hardcoded: category fallback `NYC TIPS`, overline `NYC CONCRETE GUIDE`, tip
numerals `01`-`05` (fixed five slots), CTA `Call (347) 577-2852`, website.
This is the only **light** card in the set.

### `tpl_project` (Thursday, project_card)

The footer of this template contained the business email. It is `[REDACTED]`
below; everything else is verbatim.

```html
<div class='card dark-card'><div class='blue-top-bar'></div><div class='grid-bg'></div><div class='blue-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-blue-border'>◆ PROJECT</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>RECENT POUR</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.project_type; "")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.project_location; "")}}</span></h1></div><div class='project-details'><div class='detail-row'><div class='detail-icon-blue'>01</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_1; "")}}</div></div><div class='detail-row'><div class='detail-icon-blue'>02</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_2; "")}}</div></div><div class='detail-row'><div class='detail-icon-blue'>03</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_3; "")}}</div></div><div class='project-stats'><div class='stat-block'><div class='stat-block-label'>TIMELINE</div><div class='stat-block-value'>{{ifempty(3.result.image_data.timeline; "")}}</div></div><div class='stat-block-divider'></div><div class='stat-block'><div class='stat-block-label'>RESULT</div><div class='stat-block-value'>{{ifempty(3.result.image_data.result_highlight; "")}}</div></div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>[REDACTED]</span><span class='footer-blue-strong'>(347) 577-2852</span></div></div>
```

Hardcoded: badge `◆ PROJECT`, overline `RECENT POUR`, detail numerals `01`-`03`,
stat labels `TIMELINE` / `RESULT`, business email in footer (redacted), phone.

### `tpl_testimonial` (Friday, testimonial)

```html
<div class='card blue-card'><div class='grid-bg-light'></div><div class='quote-deco-bg'>&ldquo;</div><div class='dark-orb-bottom'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub-white'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-glass'>★ 5-STAR REVIEW</div></div><div class='quote-body'><div class='stars-row'><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span></div><div class='testimonial-text'>{{ifempty(3.result.image_data.review_quote; "")}}</div><div class='testimonial-sub'>{{ifempty(3.result.image_data.review_subtitle; "")}}</div></div><div class='card-footer blue-card-footer'><div class='author-block'><div class='author-circle'>{{ifempty(3.result.image_data.client_initials; "MD")}}</div><div class='author-info'><div class='author-name'>{{ifempty(3.result.image_data.client_name; "")}}</div><div class='author-role'>{{ifempty(3.result.image_data.client_location; "")}}</div></div></div><span class='url-light'>nycconcretecontractors.com</span></div></div>
```

Hardcoded: badge `★ 5-STAR REVIEW`, **five hardcoded stars** (always 5 regardless
of content), decorative `&ldquo;` glyph, initials fallback `MD`, website.
The only **blue-gradient** card. Note for migration: this fabricates a customer
review and a customer name from the model, with a permanent five-star rating.

### `tpl_warning` (Saturday, warning_card)

```html
<div class='card dark-card'><div class='blue-top-bar-thick'></div><div class='grid-bg'></div><div class='blue-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-warning'>⚠ WARNING</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>COMMON MISTAKE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.warning_title; "")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.highlight_word; "")}}</span></h1></div><div class='warning-blocks'><div class='warn-block'><div class='warn-label-blue'>THE MISTAKE</div><div class='warn-text'>{{ifempty(3.result.image_data.mistake_description; "")}}</div></div><div class='warn-block consequence-block'><div class='warn-label-blue'>CONSEQUENCE</div><div class='warn-text'>{{ifempty(3.result.image_data.consequence; "")}}</div></div><div class='warn-block solution-block'><div class='warn-label-green'>DO THIS INSTEAD</div><div class='warn-text-white'>{{ifempty(3.result.image_data.solution_text_warning; "")}}</div></div><div class='pro-tip-bar'><span class='pro-tip-label'>PRO TIP:</span> {{ifempty(3.result.image_data.pro_tip; "")}}</div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Avoid costly mistakes</span><span class='footer-blue-strong'>(347) 577-2852</span></div></div>
```

Hardcoded: badge `⚠ WARNING`, overline `COMMON MISTAKE`, labels `THE MISTAKE` /
`CONSEQUENCE` / `DO THIS INSTEAD` / `PRO TIP:`, footer `Avoid costly mistakes`,
phone. This is the only template that introduces a **green** accent
(`#22C55E` border, `#4ADE80` label) for the solution block.

### `tpl_quote` (Sunday, quote_card)

```html
<div class='card black-quote-card'><div class='grid-bg'></div><div class='blue-side-bar'></div><div class='blue-orb-large'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>CONCRETE CONTRACTORS NYC</span></div><div class='badge-blue-border'>✦ {{ifempty(3.result.image_data.category_tag; "OUR PROMISE")}}</div></div><div class='quote-block-center'><div class='blue-accent-bar'></div><div class='overline-blue-quote'>OUR APPROACH</div><div class='quote-mega-text'>{{ifempty(3.result.image_data.quote_part1; "")}} <span class='blue-highlight'>{{ifempty(3.result.image_data.quote_part2; "")}}</span></div><div class='quote-sub-text'>{{ifempty(3.result.image_data.subquote; "")}}</div></div><div class='card-footer dark-footer'><div class='since-block'><div class='since-number'>5</div><div class='since-text'>BOROUGHS<br>SERVED DAILY</div></div><div class='contact-stack'><span class='contact-line'>(347) 577-2852</span><span class='contact-line-blue'>nycconcretecontractors.com</span></div></div></div>
```

Hardcoded: category fallback `OUR PROMISE`, overline `OUR APPROACH`, the
footer stat block `5` + `BOROUGHS SERVED DAILY`, phone, website.
The only card with a **left vertical** accent bar rather than a top bar.

### `shared_css` (verbatim, single line as stored)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.dark-card{background:linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#0F172A 100%);color:white}.light-card{background:#F8FAFC;color:#0F172A;gap:32px;justify-content:flex-start}.blue-card{background:linear-gradient(135deg,#1E90FF 0%,#0EA5E9 50%,#0284C7 100%);color:white}.black-quote-card{background:#0F172A;color:white;justify-content:center}.blue-top-bar{position:absolute;top:0;left:0;width:100%;height:12px;background:#1E90FF;z-index:5}.blue-top-bar-thick{position:absolute;top:0;left:0;width:100%;height:16px;background:#1E90FF;z-index:5}.blue-side-bar{position:absolute;top:0;left:0;width:12px;height:100%;background:#1E90FF;z-index:5}.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(30,144,255,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(30,144,255,0.07) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.grid-bg-light{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.05) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.blue-orb{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(30,144,255,0.25) 0%,transparent 70%);pointer-events:none;z-index:1}.blue-orb-top{position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(30,144,255,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.blue-orb-large{position:absolute;bottom:-300px;right:-300px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(30,144,255,0.2) 0%,transparent 70%);pointer-events:none;z-index:1}.light-orb{position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:rgba(30,144,255,0.08);pointer-events:none;z-index:1}.dark-orb-bottom{position:absolute;bottom:-300px;left:-300px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.quote-deco-bg{position:absolute;top:60px;right:60px;font-size:500px;line-height:0.6;opacity:0.1;font-family:Georgia,serif;font-weight:900;color:white;pointer-events:none;z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3;padding-top:8px}.light-header-style{padding-bottom:28px;border-bottom:3px solid #E2E8F0}.logo-group{display:flex;flex-direction:column;gap:4px}.brand-makkah{font-size:54px;font-weight:700;letter-spacing:2px;color:white;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-makkah-dark{font-size:54px;font-weight:700;letter-spacing:2px;color:#0F172A;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-sub{font-size:14px;font-weight:600;letter-spacing:4px;color:#60A5FA}.brand-sub-blue{font-size:14px;font-weight:600;letter-spacing:4px;color:#1E90FF}.brand-sub-white{font-size:14px;font-weight:600;letter-spacing:4px;color:rgba(255,255,255,0.9)}.badge-blue-border{background:rgba(30,144,255,0.15);border:2px solid #1E90FF;padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-blue-solid{background:#1E90FF;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-warning{background:#1E90FF;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-glass{background:rgba(0,0,0,0.25);border:2px solid rgba(255,255,255,0.3);padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.title-block{position:relative;z-index:3}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}.blue-bar{width:36px;height:6px;background:#1E90FF}.overline-blue{font-size:20px;color:#60A5FA;font-weight:900;letter-spacing:4px}.overline-blue-light{font-size:20px;color:#1E90FF;font-weight:900;letter-spacing:4px}.overline-blue-quote{font-size:24px;color:#60A5FA;font-weight:900;letter-spacing:5px;margin-bottom:24px}.service-title{font-size:80px;font-weight:900;color:white;line-height:1.05;letter-spacing:-2.5px}.cheat-title-dark{font-size:80px;font-weight:900;color:#0F172A;line-height:1.05;letter-spacing:-2.5px}.blue-highlight{color:#1E90FF}.service-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.block-left-blue{background:rgba(255,255,255,0.05);border-left:6px solid #1E90FF;padding:22px 28px}.block-label{font-size:18px;color:#60A5FA;font-weight:900;letter-spacing:3px;margin-bottom:8px}.block-text{font-size:28px;color:white;font-weight:700;line-height:1.35}.tag-row{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.tag-blue{background:rgba(30,144,255,0.18);padding:10px 20px;font-size:18px;color:white;font-weight:700;letter-spacing:0.5px}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.mega-stat{font-size:340px;font-weight:900;color:white;line-height:0.95;letter-spacing:-14px;margin-bottom:16px}.blue-suffix{color:#1E90FF;font-size:200px}.stat-desc{font-size:40px;color:#CBD5E1;line-height:1.3;font-weight:500;max-width:900px}.badge-row{display:flex;gap:16px;margin-top:36px;flex-wrap:wrap}.trust-badge{background:rgba(30,144,255,0.15);border-left:6px solid #1E90FF;padding:14px 24px;font-size:20px;color:white;font-weight:900;letter-spacing:2px}.tip-list-light{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card-light{background:white;border-left:8px solid #1E90FF;padding:20px 26px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)}.tip-num-black{background:#0F172A;color:white;min-width:62px;height:62px;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main-dark{font-size:28px;color:#0F172A;font-weight:900;line-height:1.25}.tip-sub-dark{font-size:18px;color:#64748B;font-weight:500;line-height:1.3}.project-details{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.detail-row{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,0.04);border-left:6px solid #1E90FF;padding:20px 26px}.detail-icon-blue{background:#1E90FF;color:white;min-width:56px;height:56px;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center}.detail-text{font-size:26px;color:white;font-weight:600;line-height:1.3}.project-stats{display:flex;align-items:center;gap:32px;margin-top:8px;background:rgba(30,144,255,0.12);border:2px solid rgba(30,144,255,0.4);padding:24px 32px}.stat-block{flex:1}.stat-block-label{font-size:16px;color:#60A5FA;font-weight:900;letter-spacing:3px;margin-bottom:6px}.stat-block-value{font-size:30px;color:white;font-weight:900;line-height:1.2}.stat-block-divider{width:2px;height:60px;background:rgba(30,144,255,0.4)}.stars-row{display:flex;gap:6px;margin-bottom:20px}.star{color:white;font-size:48px;font-weight:900}.testimonial-text{font-size:54px;font-weight:900;line-height:1.2;letter-spacing:-1.5px;color:white}.testimonial-sub{font-size:24px;opacity:0.9;margin-top:18px;font-weight:500;line-height:1.4}.author-block{display:flex;align-items:center;gap:18px}.author-circle{width:60px;height:60px;border-radius:50%;background:rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white}.author-info{display:flex;flex-direction:column}.author-name{font-size:22px;font-weight:900;color:white}.author-role{font-size:18px;opacity:0.85;color:white;font-weight:500}.warning-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.warn-block{background:rgba(255,255,255,0.05);border-left:6px solid #1E90FF;padding:22px 28px}.consequence-block{background:rgba(30,144,255,0.15);border-left:6px solid #1E90FF}.solution-block{background:rgba(34,197,94,0.12);border-left:6px solid #22C55E}.warn-label-blue{font-size:18px;color:#60A5FA;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-label-green{font-size:18px;color:#4ADE80;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-text{font-size:26px;color:white;font-weight:700;line-height:1.35}.warn-text-white{font-size:26px;color:white;font-weight:700;line-height:1.35}.pro-tip-bar{background:rgba(30,144,255,0.2);padding:18px 24px;font-size:22px;color:white;font-weight:600;line-height:1.4;border:2px solid rgba(30,144,255,0.5);margin-top:8px}.pro-tip-label{color:#60A5FA;font-weight:900;letter-spacing:2px;margin-right:8px}.quote-block-center{position:relative;z-index:3;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:880px}.blue-accent-bar{height:8px;width:80px;background:#1E90FF;margin-bottom:24px}.quote-mega-text{font-size:96px;font-weight:900;line-height:1.05;letter-spacing:-3px;color:white;margin-bottom:28px}.quote-sub-text{font-size:32px;color:#CBD5E1;line-height:1.4;font-weight:500;max-width:780px}.since-block{display:flex;align-items:center;gap:14px}.since-number{font-size:80px;font-weight:900;color:#1E90FF;line-height:1}.since-text{font-size:14px;font-weight:900;color:white;letter-spacing:2.5px;line-height:1.3}.contact-stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.contact-line{font-size:22px;color:white;font-weight:700;letter-spacing:1px}.contact-line-blue{font-size:18px;color:#60A5FA;font-weight:700;letter-spacing:0.5px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;position:relative;z-index:3}.dark-footer{border-top:2px solid rgba(30,144,255,0.4)}.light-footer-style{border-top:3px solid #E2E8F0}.blue-card-footer{border-top:2px solid rgba(255,255,255,0.3)}.footer-light-text{font-size:20px;color:#94A3B8;letter-spacing:1px;font-weight:600}.footer-blue-strong{font-size:22px;color:#1E90FF;font-weight:900;letter-spacing:0.5px}.footer-gray{font-size:20px;color:#64748B;font-weight:700;letter-spacing:0.5px}.url-light{font-size:20px;color:white;opacity:0.9;letter-spacing:1.5px;font-weight:600}
```

---

## 7. Module 5 — `util:SetVariable2` (template selector)

Variable name `final_html`, scope `roundtrip`. Full value:

```
{{switch(2.image_template; "service_card"; 4.tpl_service; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "project_card"; 4.tpl_project; "testimonial"; 4.tpl_testimonial; "warning_card"; 4.tpl_warning; "quote_card"; 4.tpl_quote)}}
```

No default branch. An unmatched `image_template` yields an empty `final_html`.

---

## 8. Module 6 — `html-css-to-image:Image` (render settings)

| Parameter | Value |
| --- | --- |
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `google_fonts` | `Inter` |
| `device_scale` | `2` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `selector` | **not set** (available in the module schema, left empty) |
| `ms_delay` | **not set** |
| `full_screen` | **not set** |
| Connection | `[REDACTED]` (label "NYC Concrete Contractors HTML/CSS to Image connection") |

Effective output: 1080x1080 CSS pixels at device scale 2, i.e. a **2160x2160 PNG**.
Because no `selector` is given, the whole viewport is captured; the `.card` rule
pins the element to exactly `1080x1080` with `overflow:hidden`, so the card fills
the frame and any overflow is silently clipped rather than resized. There is no
autofit or text-shrink logic anywhere. Overflow control is entirely delegated to
the word budgets in the prompt.

### Module 7 — `html-css-to-image:GetImage`

| Parameter | Value |
| --- | --- |
| `image_id` | `{{6.id}}` |
| `format` | `png` |
| Connection | `[REDACTED]` (a **different** connection from module 6, label "My HTML/CSS to Image connection") |

---

## 9. Colour, font, logo and constant index

### Colour hexes and where they appear

| Hex | Role | Appears in |
| --- | --- | --- |
| `#1E90FF` | Primary brand blue (dodger blue) | Every template. Top bar, side bar, all left borders, badges, `.blue-highlight` headline accent, blue-card gradient start, `.blue-suffix`, `.since-number`, `.footer-blue-strong`, all `rgba(30,144,255,…)` washes |
| `#0F172A` | Deep navy ink / dark card base | `.dark-card` gradient stops 0% and 100%, `.black-quote-card` background, `.light-card` text colour, `.cheat-title-dark`, `.tip-num-black`, `.tip-main-dark`, `.brand-makkah-dark` |
| `#1E293B` | Dark card gradient midpoint | `.dark-card` 50% stop |
| `#F8FAFC` | Light card field | `.light-card` background |
| `#0EA5E9` | Blue card gradient midpoint | `.blue-card` 50% stop |
| `#0284C7` | Blue card gradient end | `.blue-card` 100% stop |
| `#60A5FA` | Soft blue support text | `.brand-sub`, `.overline-blue`, `.block-label`, `.stat-block-label`, `.warn-label-blue`, `.pro-tip-label`, `.contact-line-blue` |
| `#E2E8F0` | Light rule | `.light-header-style` border-bottom, `.light-footer-style` border-top |
| `#CBD5E1` | Muted body text on dark | `.stat-desc`, `.quote-sub-text` |
| `#64748B` | Muted body text on light | `.tip-sub-dark`, `.footer-gray` |
| `#94A3B8` | Muted footer text on dark | `.footer-light-text` |
| `#22C55E` | Green, solution block border | `.solution-block` (warning_card only) |
| `#4ADE80` | Green, solution label | `.warn-label-green` (warning_card only) |
| `rgba(30,144,255,…)` | 0.07 / 0.08 / 0.12 / 0.15 / 0.18 / 0.2 / 0.25 / 0.3 / 0.4 / 0.5 washes of `#1E90FF` | grid backgrounds, orbs, badge fills, tag fills, trust badges, project stat panel, pro-tip bar, all dark footers |
| `white` / `rgba(255,255,255,…)` | Ink on dark, glass fills | headings, body, `.tip-card-light` background, block fills at 0.04/0.05 |
| `rgba(0,0,0,…)` | Shadows and glass | `.badge-glass`, `.author-circle`, `.dark-orb-bottom`, tip card shadow |

The palette is entirely hardcoded in one shared CSS string. There is **no brand
kit, no colour variable, no per-business colour injection**. Migrating this
means every hex above becomes a token fed from a saved brand palette.

### Font families and where they appear

| Font | Appears in |
| --- | --- |
| `Inter` | Global `*` rule: `font-family:'Inter',-apple-system,sans-serif`. Also passed to the renderer via `google_fonts: "Inter"` so it is actually loaded |
| `Georgia, serif` | `.brand-makkah` and `.brand-makkah-dark` (the italic wordmark) and `.quote-deco-bg` (the giant decorative quotation mark) |
| `-apple-system, sans-serif` | Fallback chain only |

### Logo

**There is no logo URL and no image asset anywhere in the scenario.** The
"logo" is pure typography: the word `Makkah` in italic Georgia 54px
(`.brand-makkah`), stacked over `CONCRETE CONTRACTORS NYC` in 14px 4px-tracked
uppercase (`.brand-sub`). Three colour variants exist for the three card
backgrounds: `.brand-sub` (`#60A5FA`), `.brand-sub-blue` (`#1E90FF`), and
`.brand-sub-white` (`rgba(255,255,255,0.9)`). No `<img>` tag exists in any
template. Nothing is fetched over the network at render time except the Inter
webfont.

### Hardcoded business constants (full list)

| Constant | Value | Where |
| --- | --- | --- |
| Business name | `Makkah Concrete Contractors NYC` | System prompt, user prompt, LinkedIn alt text |
| Wordmark | `Makkah` | All 7 templates (`.brand-makkah`) |
| Wordmark subline | `CONCRETE CONTRACTORS NYC` | All 7 templates (`.brand-sub`) |
| Address | `12115 103rd Avenue, Queens, NY 11419` | System prompt only |
| Phone | `(347) 577-2852` | System prompt; footers of tpl_service, tpl_stat, tpl_cheat (as `Call (347) 577-2852`), tpl_project, tpl_warning, tpl_quote |
| Email | `[REDACTED]` | System prompt (`- Email:` line); tpl_project footer |
| Website | `https://nycconcretecontractors.com/` in the prompt; `nycconcretecontractors.com →` in tpl_stat and tpl_cheat footers; `nycconcretecontractors.com` in tpl_testimonial and tpl_quote footers | Prompt + 4 templates |
| Service area (long) | `Manhattan, Brooklyn, Queens, Bronx, Staten Island + Westchester (New Rochelle, Yonkers, White Plains, Mount Vernon)` | System prompt |
| Service area (short) | `Serving NYC and Westchester` | tpl_service footer |
| Service area (stat) | `5` + `BOROUGHS SERVED DAILY` | tpl_quote footer |
| Services list | 11 numbered services (Concrete Sidewalk Repair, New Sidewalk Installation, Concrete Driveways, Stamped Concrete, Concrete Patios, Concrete Steps, Foundations and Slabs, Commercial Concrete, Sidewalk Violation Removal, Curb and Gutter Work, Parking Lots and Pads) | System prompt |
| Credential claim | `Licensed and insured for NYC work` / badge `LICENSED & INSURED` / trust badge fallbacks `LICENSED`, `INSURED`, `DOT` | System prompt + tpl_stat |
| Regulator references | `DOT`, `DOB` | System prompt rule 3 |
| Domain-fact anchors | `4-inch`, `28-day cure`, `PSI` | System prompt rule 4 |
| Tag fallbacks | `Sidewalks`, `Driveways`, `Patios` | tpl_service |
| Stat fallbacks | `NYC STANDARD` overline, `4` big stat, hardcoded `"` inch suffix | tpl_stat |
| Category fallbacks | `NYC TIPS` (cheatsheet), `OUR PROMISE` (quote_card) | tpl_cheat, tpl_quote |
| Initials fallback | `MD` | tpl_testimonial |
| Fixed overlines | `EXPERT CONCRETE`, `NYC CONCRETE GUIDE`, `RECENT POUR`, `COMMON MISTAKE`, `OUR APPROACH` | one per template |
| Fixed badges | `★ SERVICE`, `LICENSED & INSURED`, `▲ {category_tag}`, `◆ PROJECT`, `★ 5-STAR REVIEW`, `⚠ WARNING`, `✦ {category_tag}` | one per template |
| Fixed block labels | `THE PROBLEM`, `OUR SOLUTION`, `THE RESULT`, `TIMELINE`, `RESULT`, `THE MISTAKE`, `CONSEQUENCE`, `DO THIS INSTEAD`, `PRO TIP:` | across templates |
| Fixed footer lines | `Serving NYC and Westchester`, `Avoid costly mistakes` | tpl_service, tpl_warning |
| CTA | No dedicated CTA constant. The CTA is the footer contact strip (phone plus website) plus the prompt rule `End EVERY post with phone, email, website` | Templates + prompt |
| Hashtags | **Not hardcoded.** The prompt asks the model for 4-5 (Facebook) and 5-7 (LinkedIn). No hashtag bank exists | Prompt only |

---

## 10. Filters, routers, error handlers, history

**None of the following exist in this scenario:**

- No routers. The flow is a single linear chain, modules 1 through 9.
- No filters on any link. Every module runs unconditionally.
- No error handler directives (no `onerror`, no `commit`/`rollback`/`resume`/
  `ignore`/`break` routes attached to any module).
- No retry route, no break/repeat handler, no DLQ (`dlq: false`).
- **No Google Sheets module.** No sheet is read or written.
- **No datastore module.** No datastore is read or written.
- **No history lookup of any kind.** Nothing records what was posted, and
  nothing checks what was posted before. Cross-run duplicate prevention relies
  purely on `temperature: 0.85` plus the day-of-week rotation. The system prompt
  says `5. Rotate across services` but the model has no memory of prior runs, so
  service rotation is a hope rather than a mechanism.
- No `interface.input` or `interface.output` (both empty arrays).

The only error tolerance is scenario-level `maxErrors: 3` with
`autoCommit: true`. If OpenAI returns malformed JSON, or the model omits the
fields for today's template, the run either fails outright or renders a card
with empty text blocks. Nothing validates the model output before rendering.

---

## 11. Publishing modules

| Module | What it posts |
| --- | --- |
| `facebook-pages:UploadPhoto` (v6) | The rendered PNG as a Page photo, caption = `{{3.result.facebook_post}}`, `fileName` = `{{7.fileName}}`, `data` = `{{7.image}}`, `page_id` = `[REDACTED]` (page label "NYC Concrete Contractor (Queens)"), connection `[REDACTED]` |
| `linkedin:CreateCompanyImagePost` (v2) | The same PNG as a company image post. `content` = `{{3.result.linkedin_post}}`, `title` = `{{3.result.topic}}`, `altText` = `Makkah Concrete Contractors NYC project insights` (hardcoded, identical on every post), `method` = `upload`, `visibility` = `PUBLIC`, `feedDistribution` = `MAIN_FEED`, `isReshareDisabledByAuthor` = `false`, `organization` = `[REDACTED]` (label "Makkah NYC Concrete Contractor"), connection `[REDACTED]` |

Despite the scenario name saying "Multi-Platform", only **two** destinations
exist: Facebook Pages and LinkedIn. There is no Instagram, Threads, X, Pinterest
or Google Business Profile module. Both destinations receive the **same image**;
only the copy differs (Facebook 180-280 words, LinkedIn 250-350 words with a B2B
register and more hashtags).

Because the chain is linear with no error routes, a Facebook failure aborts the
run before LinkedIn is attempted.

---

## 12. Migration notes for Cyflow

Points worth carrying over or deliberately rejecting:

1. **Day-of-week rhythm is the core idea.** Seven content types, each bound to
   its own visual template, so the week has a shape instead of seven
   interchangeable posts. Worth keeping.
2. **Per-field word budgets in the prompt are the only overflow control.** The
   render path has no autofit. Cyflow should not copy that fragility; budgets
   plus a measured fit check is the better version.
3. **Two prompts in one call.** Post copy and poster copy are generated in a
   single JSON response, so the image and the caption stay on topic together.
4. **No history, no dedupe.** This is the clearest weakness. Rotation across
   services is instructed but never enforced or verified.
5. **Palette, fonts, wordmark, phone, email, website, service list and service
   area are all hardcoded** across the prompt and seven HTML strings. Every one
   of those has to become a per-business field.
6. **The wordmark is typographic, not an uploaded logo.** Any migration that
   assumes an uploaded logo asset will need a text-wordmark fallback.
7. **Fabricated social proof.** The Friday template renders a model-invented
   customer quote, name, initials and location under a permanently five-star
   rating. That conflicts with a no-invented-facts rule and should not be
   carried across as-is.
8. **The timezone gap.** Day-of-week resolves in the Make org timezone, not the
   business's local timezone, so "Monday" content can publish on Sunday evening
   in New York.
