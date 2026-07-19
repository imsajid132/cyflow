# Make.com scenario extraction: Sidewalks Repair NYC

Migration reference. Extracted verbatim from the live Make blueprint.

All connection ids, `__IMTCONN__` values, provider account/page/organization ids
and email addresses are replaced with the literal token `[REDACTED]`.
Prompt text, rhythm expressions, HTML/CSS and business constants are verbatim.

---

## 1. Scenario identity and schedule

| Field | Value |
|---|---|
| Name | `Sidewalks Repair NYC - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9277882` |
| Team id | `2388544` |
| Folder | `null` |
| Description | (empty) |
| Active | `true` |
| Paused | `false` |
| Created | `2026-05-22T18:36:52.045Z` |
| Last edit | `2026-06-25T12:42:09.110Z` |
| Next exec | `2026-07-20T09:00:00.000Z` |
| Hook | `null` (no webhook, polling/scheduled only) |
| Used packages | `builtin`, `util`, `openai-gpt-3`, `util`, `util`, `html-css-to-image`, `html-css-to-image`, `facebook-pages`, `linkedin` |

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

Reading: the scenario polls every 900 seconds (15 minutes), but execution is
restricted to a one minute window at 14:00 to 14:01, on all seven days
(1=Mon .. 6=Sat, 0=Sun). Effectively "once daily at 14:00 account-local".

**Timezone caveat for migration.** `nextExec` is `09:00:00Z` while the restrict
window says `14:00`. That implies the Make account timezone is UTC+5 (Asia/Karachi),
not America/New_York. The NYC business therefore publishes at 09:00 UTC, which is
05:00 America/New_York in EDT. If the rewrite resolves the schedule in the
business timezone this behaviour will change.

### Scenario metadata (verbatim)

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

`interface`: `{ "input": [], "output": [] }` (no scenario inputs/outputs).

---

## 2. Module map

Strictly linear. No routers, no branches, no orphans.

| # | Module | Version | Designer x,y | Purpose |
|---|---|---|---|---|
| 1 | `builtin:BasicFeeder` | 1 | 0,0 | Single-bundle kickoff |
| 2 | `util:SetVariables` | 1 | 300,0 | Day rhythm: `day_of_week`, `content_type`, `image_template` |
| 3 | `openai-gpt-3:CreateCompletion` | 1 | 600,0 | Single LLM call, JSON out |
| 4 | `util:SetVariables` | 1 | 900,0 | 7 HTML templates + `shared_css` |
| 5 | `util:SetVariable2` | 1 | 1200,0 | `final_html` template switch |
| 6 | `html-css-to-image:Image` | 1 | 1500,0 | Render 1080x1080 @2x |
| 7 | `html-css-to-image:GetImage` | 1 | 1800,0 | Fetch PNG binary |
| 8 | `facebook-pages:UploadPhoto` | 6 | 2100,0 | Publish to Facebook Page |
| 9 | `linkedin:CreateCompanyImagePost` | 2 | 2400,0 | Publish to LinkedIn company page |

---

## 3. Module 1 - `builtin:BasicFeeder`

```json
{
  "mapper": { "array": "[{\"trigger\":\"start\"}]" },
  "parameters": {}
}
```

Emits exactly one bundle so the downstream chain runs once per scheduled fire.

---

## 4. Module 2 - `util:SetVariables` (the rhythm)

`scope: "roundtrip"`. Three variables, verbatim values.

### `day_of_week`

```
{{formatDate(now; "dddd")}}
```

### `content_type` (full switch expression, verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_spotlight"; "Tuesday"; "trust_stat"; "Wednesday"; "nyc_code_tip"; "Thursday"; "project_showcase"; "Friday"; "customer_testimonial"; "Saturday"; "pro_tip_warning"; "Sunday"; "brand_insight")}}
```

### `image_template` (full switch expression, verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_card"; "Tuesday"; "stat_card"; "Wednesday"; "cheatsheet"; "Thursday"; "project_card"; "Friday"; "testimonial"; "Saturday"; "warning_card"; "Sunday"; "quote_card")}}
```

### Resolved rhythm table

| Day | `content_type` | `image_template` |
|---|---|---|
| Monday | `service_spotlight` | `service_card` |
| Tuesday | `trust_stat` | `stat_card` |
| Wednesday | `nyc_code_tip` | `cheatsheet` |
| Thursday | `project_showcase` | `project_card` |
| Friday | `customer_testimonial` | `testimonial` |
| Saturday | `pro_tip_warning` | `warning_card` |
| Sunday | `brand_insight` | `quote_card` |

Note: these are **two independent switches** over the same day name, not one
switch with a derived template. The two vocabularies differ (`service_spotlight`
vs `service_card`), so a migration must preserve both names or collapse them
deliberately.

There is no default/fallback arm in either switch. A locale where
`formatDate(now; "dddd")` returns a non-English day name yields an empty
`content_type` and an empty `image_template`, which would make module 5 produce
empty HTML.

---

## 5. Module 3 - `openai-gpt-3:CreateCompletion`

### Parameters

| Field | Value |
|---|---|
| `select` | `chat` |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `2500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| `__IMTCONN__` | `[REDACTED]` |
| Connection label | `Pioneer OpenAI` (scoped, app `openai-gpt-3`) |

Downstream reads use `3.result.<field>`, i.e. the parsed JSON object.

### System prompt (verbatim, complete)

```
You are the Marketing Lead for Sidewalks Repair NYC, a licensed and insured sidewalk contractor in NYC serving all 5 boroughs plus Westchester.

BUSINESS:
- Phone: (917) 207-5803
- Email: [REDACTED]
- Website: https://sidewalksrepairnyc.com/
- Address: 12115 103rd Avenue, Queens, NY 11419
- Service areas: Manhattan, Brooklyn, Queens, Bronx, Staten Island + Yonkers, Mount Vernon, New Rochelle, White Plains, Westchester

SERVICES: DOT Sidewalk Violation Removal, Concrete Sidewalk Repair, Sidewalk Replacement, Tree Root Damage Repair, Trip Hazard Removal & Leveling, ADA-Compliant Sidewalk Upgrades, New Sidewalk Installation, Curb Repair, Sidewalk Crack Filling & Sealing, Driveway Apron Repair.

RULES:
- First-person as Sidewalks Repair NYC
- NO emojis, no fancy symbols
- Plain numbered lists (1. 2. 3.)
- \n\n between every paragraph and every list item
- Each post ends with phone, email, website on separate lines
- 4-7 NYC-relevant hashtags at end
- NYC-specific (DOT violations, boroughs, ADA, permits)
- NO double quotes inside text values

You MUST output valid JSON with image_data fields FILLED with real content for today's template. No placeholders, no dots.

TODAY: {{2.day_of_week}} | Content type: {{2.content_type}} | Template: {{2.image_template}}

For template = service_card: fill service_name, service_subtitle, problem_text, solution_text, result_text, tags (3 items like 'DOT Violations', 'Tree Roots', 'Trip Hazards').

For template = stat_card: fill big_stat (e.g. 75, 4, 100), stat_label, overline (1-2 words like 'DOT DEADLINE'), badges (3 items like LICENSED/INSURED/DOT).

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

Note: the `\n\n` on the RULES line is a **literal backslash-n backslash-n** in the
prompt source, not an actual newline.

### User prompt (verbatim, complete)

```
Generate today's post for Sidewalks Repair NYC.

Day: {{2.day_of_week}}
Content type: {{2.content_type}}
Template: {{2.image_template}}

Make it fresh, NYC-specific, about sidewalk repair, DOT violations, tree roots, trip hazards, or ADA work. Fill image_data fields for template {{2.image_template}} with REAL short text.

Return JSON only.
```

### Demanded JSON output schema, per-field constraints

Top level, 5 fields:

| Field | Type | Constraint as stated in prompt |
|---|---|---|
| `topic` | string | "3-5 word topic" |
| `service_focus` | string | "which service" (expected to be one of the 10 SERVICES) |
| `facebook_post` | string | "180-280 words with proper formatting and contact info" |
| `linkedin_post` | string | "250-350 words professional B2B with contact info" |
| `image_data` | object | 36 keys, see below |

`image_data`, 36 keys, grouped by owning template. Fields not owned by today's
template must be the empty string `""` (or `[]` for arrays).

**service_card** (Monday)

| Field | Type | Constraint |
|---|---|---|
| `service_name` | string | Title line 1 |
| `service_subtitle` | string | Title line 2, rendered highlighted |
| `problem_text` | string | "THE PROBLEM" block |
| `solution_text` | string | "OUR SOLUTION" block |
| `result_text` | string | "THE RESULT" block |
| `tags` | array | exactly 3 items, "like 'DOT Violations', 'Tree Roots', 'Trip Hazards'" |

**stat_card** (Tuesday)

| Field | Type | Constraint |
|---|---|---|
| `big_stat` | string | numeric-ish, "e.g. 75, 4, 100" |
| `stat_label` | string | descriptive sentence under the number |
| `overline` | string | "1-2 words like 'DOT DEADLINE'" |
| `badges` | array | exactly 3 items, "like LICENSED/INSURED/DOT" |

**cheatsheet** (Wednesday)

| Field | Type | Constraint |
|---|---|---|
| `title_line1` | string | Title line 1 |
| `title_line2` | string | Title line 2, rendered highlighted |
| `category_tag` | string | badge text |
| `tips` | array | exactly 5, "5 short" |
| `tip_subtitles` | array | exactly 5, "5 short" |

**project_card** (Thursday)

| Field | Type | Constraint |
|---|---|---|
| `project_type` | string | Title line 1 |
| `project_location` | string | Title line 2, highlighted |
| `detail_1` | string | numbered row 01 |
| `detail_2` | string | numbered row 02 |
| `detail_3` | string | numbered row 03 |
| `timeline` | string | "TIMELINE" stat block |
| `result_highlight` | string | "RESULT" stat block |

**testimonial** (Friday)

| Field | Type | Constraint |
|---|---|---|
| `review_quote` | string | "12-18 words" |
| `review_subtitle` | string | secondary line |
| `client_name` | string | author name |
| `client_location` | string | author role/location line |
| `client_initials` | string | avatar circle text |

**warning_card** (Saturday)

| Field | Type | Constraint |
|---|---|---|
| `warning_title` | string | Title line 1 |
| `highlight_word` | string | Title line 2, highlighted |
| `mistake_description` | string | "THE MISTAKE" block |
| `consequence` | string | "CONSEQUENCE" block |
| `solution_text_warning` | string | "DO THIS INSTEAD" block |
| `pro_tip` | string | "PRO TIP:" bar |

**quote_card** (Sunday)

| Field | Type | Constraint |
|---|---|---|
| `quote_part1` | string | first half of mega quote |
| `quote_part2` | string | second half, highlighted |
| `subquote` | string | supporting sentence |
| `category_tag` | string | badge text (**shared with cheatsheet**) |

Collision to carry into the rewrite: `category_tag` is the only `image_data`
field owned by two templates.

Global copy rules imposed by the system prompt: first person as the business,
no emojis, no fancy symbols, plain numbered lists `1. 2. 3.`, literal `\n\n`
between every paragraph and list item, each post ends with phone / email /
website on separate lines, 4-7 NYC-relevant hashtags at end, NYC-specific
subject matter, and no double quote characters inside any text value.

---

## 6. Module 4 - `util:SetVariables` (templates + CSS)

`scope: "roundtrip"`. Eight variables: seven HTML templates and one stylesheet.
All values verbatim below. Every dynamic slot is an `ifempty()` with a real
content fallback, so the render never blanks out.

### `tpl_service`

```html
<div class='card dark-card'><div class='purple-top-bar'></div><div class='grid-bg'></div><div class='purple-orb'></div><div class='header'><div class='logo-group'><span class='brand-name'>SRN</span><span class='brand-sub'>SIDEWALKS REPAIR NYC</span></div><div class='badge-purple-border'>★ SERVICE</div></div><div class='title-block'><div class='overline-row'><div class='purple-bar'></div><span class='overline-purple'>EXPERT SIDEWALK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.service_name; "Sidewalk Repair")}}<br><span class='purple-highlight'>{{ifempty(3.result.image_data.service_subtitle; "and Replacement")}}</span></h1></div><div class='service-blocks'><div class='block-left-purple'><div class='block-label'>THE PROBLEM</div><div class='block-text'>{{ifempty(3.result.image_data.problem_text; "Cracked sidewalks become DOT violations fast")}}</div></div><div class='block-left-purple'><div class='block-label'>OUR SOLUTION</div><div class='block-text'>{{ifempty(3.result.image_data.solution_text; "Expert repair with permits handled")}}</div></div><div class='block-left-purple'><div class='block-label'>THE RESULT</div><div class='block-text'>{{ifempty(3.result.image_data.result_text; "Safe smooth sidewalks built to last")}}</div></div><div class='tag-row'><div class='tag-purple'>● {{ifempty(get(3.result.image_data.tags; 1); "DOT Violations")}}</div><div class='tag-purple'>● {{ifempty(get(3.result.image_data.tags; 2); "Tree Roots")}}</div><div class='tag-purple'>● {{ifempty(get(3.result.image_data.tags; 3); "Trip Hazards")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Serving NYC and Westchester</span><span class='footer-purple-strong'>(917) 207-5803</span></div></div>
```

### `tpl_stat`

```html
<div class='card dark-card'><div class='purple-top-bar'></div><div class='grid-bg'></div><div class='purple-orb-top'></div><div class='header'><div class='logo-group'><span class='brand-name'>SRN</span><span class='brand-sub'>SIDEWALKS REPAIR NYC</span></div><div class='badge-purple-border'>LICENSED & INSURED</div></div><div class='stat-body'><div class='overline-row'><div class='purple-bar'></div><span class='overline-purple'>{{ifempty(3.result.image_data.overline; "DOT DEADLINE")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.big_stat; "75")}}<span class='purple-suffix'>d</span></div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "Days NYC gives you to fix sidewalk violations or face fines")}}</div><div class='badge-row'><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 1); "LICENSED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 2); "INSURED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 3); "DOT")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>(917) 207-5803</span><span class='footer-purple-strong'>sidewalksrepairnyc.com →</span></div></div>
```

### `tpl_cheat`

```html
<div class='card light-card'><div class='purple-top-bar'></div><div class='light-orb'></div><div class='header light-header-style'><div class='logo-group'><span class='brand-name-dark'>SRN</span><span class='brand-sub-purple'>SIDEWALKS REPAIR NYC</span></div><div class='badge-purple-solid'>▲ {{ifempty(3.result.image_data.category_tag; "NYC TIPS")}}</div></div><div class='title-block'><div class='overline-row'><div class='purple-bar'></div><span class='overline-purple-light'>SIDEWALK GUIDE</span></div><h1 class='cheat-title-dark'>{{ifempty(3.result.image_data.title_line1; "5 facts about NYC")}}<br><span class='purple-highlight'>{{ifempty(3.result.image_data.title_line2; "sidewalk repairs")}}</span></h1></div><div class='tip-list-light'><div class='tip-card-light'><div class='tip-num-black'>01</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 1); "DOT gives 75 days")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "Fix violations or face fines")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>02</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 2); "4-inch concrete minimum")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "NYC code requires this thickness")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>03</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 3); "Owner is responsible")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "Property owner pays for repairs")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>04</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 4); "Get permits first")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "Required before any work starts")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>05</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 5); "Licensed contractors only")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "Avoid fines and failed inspections")}}</span></div></div></div><div class='card-footer light-footer-style'><span class='footer-gray'>Call (917) 207-5803</span><span class='footer-purple-strong'>sidewalksrepairnyc.com →</span></div></div>
```

### `tpl_project`

```html
<div class='card dark-card'><div class='purple-top-bar'></div><div class='grid-bg'></div><div class='purple-orb'></div><div class='header'><div class='logo-group'><span class='brand-name'>SRN</span><span class='brand-sub'>SIDEWALKS REPAIR NYC</span></div><div class='badge-purple-border'>◆ PROJECT</div></div><div class='title-block'><div class='overline-row'><div class='purple-bar'></div><span class='overline-purple'>RECENT WORK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.project_type; "DOT Violation Fix")}}<br><span class='purple-highlight'>{{ifempty(3.result.image_data.project_location; "Brooklyn")}}</span></h1></div><div class='project-details'><div class='detail-row'><div class='detail-icon-purple'>01</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_1; "Full slab replacement")}}</div></div><div class='detail-row'><div class='detail-icon-purple'>02</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_2; "Permits handled fully")}}</div></div><div class='detail-row'><div class='detail-icon-purple'>03</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_3; "DOT violation cleared")}}</div></div><div class='project-stats'><div class='stat-block'><div class='stat-block-label'>TIMELINE</div><div class='stat-block-value'>{{ifempty(3.result.image_data.timeline; "2 days")}}</div></div><div class='stat-block-divider'></div><div class='stat-block'><div class='stat-block-label'>RESULT</div><div class='stat-block-value'>{{ifempty(3.result.image_data.result_highlight; "Violation removed")}}</div></div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>[REDACTED]</span><span class='footer-purple-strong'>(917) 207-5803</span></div></div>
```

(The `footer-light-text` span in `tpl_project` held the business email address in
the source. Redacted here.)

### `tpl_testimonial`

```html
<div class='card purple-card'><div class='grid-bg-light'></div><div class='quote-deco-bg'>&ldquo;</div><div class='dark-orb-bottom'></div><div class='header'><div class='logo-group'><span class='brand-name'>SRN</span><span class='brand-sub-white'>SIDEWALKS REPAIR NYC</span></div><div class='badge-glass'>★ 5-STAR REVIEW</div></div><div class='quote-body'><div class='stars-row'><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span><span class='star'>★</span></div><div class='testimonial-text'>{{ifempty(3.result.image_data.review_quote; "Fast professional sidewalk repair. Cleared our DOT violation in just two days.")}}</div><div class='testimonial-sub'>{{ifempty(3.result.image_data.review_subtitle; "Clean work and great communication throughout.")}}</div></div><div class='card-footer purple-card-footer'><div class='author-block'><div class='author-circle'>{{ifempty(3.result.image_data.client_initials; "MR")}}</div><div class='author-info'><div class='author-name'>{{ifempty(3.result.image_data.client_name; "Maria R.")}}</div><div class='author-role'>{{ifempty(3.result.image_data.client_location; "Brooklyn")}}</div></div></div><span class='url-light'>sidewalksrepairnyc.com</span></div></div>
```

### `tpl_warning`

```html
<div class='card dark-card'><div class='purple-top-bar-thick'></div><div class='grid-bg'></div><div class='purple-orb'></div><div class='header'><div class='logo-group'><span class='brand-name'>SRN</span><span class='brand-sub'>SIDEWALKS REPAIR NYC</span></div><div class='badge-warning'>⚠ WARNING</div></div><div class='title-block'><div class='overline-row'><div class='purple-bar'></div><span class='overline-purple'>COMMON MISTAKE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.warning_title; "Do not ignore")}}<br><span class='purple-highlight'>{{ifempty(3.result.image_data.highlight_word; "DOT notices")}}</span></h1></div><div class='warning-blocks'><div class='warn-block'><div class='warn-label-purple'>THE MISTAKE</div><div class='warn-text'>{{ifempty(3.result.image_data.mistake_description; "Ignoring NYC DOT violation letters when they arrive")}}</div></div><div class='warn-block consequence-block'><div class='warn-label-purple'>CONSEQUENCE</div><div class='warn-text'>{{ifempty(3.result.image_data.consequence; "City does the work and bills triple cost")}}</div></div><div class='warn-block solution-block'><div class='warn-label-green'>DO THIS INSTEAD</div><div class='warn-text-white'>{{ifempty(3.result.image_data.solution_text_warning; "Call licensed contractors within the 75-day window")}}</div></div><div class='pro-tip-bar'><span class='pro-tip-label'>PRO TIP:</span> {{ifempty(3.result.image_data.pro_tip; "Inspect sidewalks yearly to catch problems before violations")}}</div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Avoid costly mistakes</span><span class='footer-purple-strong'>(917) 207-5803</span></div></div>
```

### `tpl_quote`

```html
<div class='card black-quote-card'><div class='grid-bg'></div><div class='purple-side-bar'></div><div class='purple-orb-large'></div><div class='header'><div class='logo-group'><span class='brand-name'>SRN</span><span class='brand-sub'>SIDEWALKS REPAIR NYC</span></div><div class='badge-purple-border'>✦ {{ifempty(3.result.image_data.category_tag; "OUR PROMISE")}}</div></div><div class='quote-block-center'><div class='purple-accent-bar'></div><div class='overline-purple-quote'>OUR APPROACH</div><div class='quote-mega-text'>{{ifempty(3.result.image_data.quote_part1; "Safe sidewalks build")}} <span class='purple-highlight'>{{ifempty(3.result.image_data.quote_part2; "safer neighborhoods")}}</span></div><div class='quote-sub-text'>{{ifempty(3.result.image_data.subquote; "We protect property owners from DOT violations and keep NYC walking safely.")}}</div></div><div class='card-footer dark-footer'><div class='since-block'><div class='since-number'>5</div><div class='since-text'>BOROUGHS<br>SERVED DAILY</div></div><div class='contact-stack'><span class='contact-line'>(917) 207-5803</span><span class='contact-line-purple'>sidewalksrepairnyc.com</span></div></div></div>
```

### `shared_css` (verbatim, complete)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.dark-card{background:linear-gradient(135deg,#1E1B4B 0%,#2D2766 50%,#1E1B4B 100%);color:white}.light-card{background:#FAFAFC;color:#1E1B4B;gap:32px;justify-content:flex-start}.purple-card{background:linear-gradient(135deg,#6366F1 0%,#4F46E5 50%,#3730A3 100%);color:white}.black-quote-card{background:#1E1B4B;color:white;justify-content:center}.purple-top-bar{position:absolute;top:0;left:0;width:100%;height:12px;background:#6366F1;z-index:5}.purple-top-bar-thick{position:absolute;top:0;left:0;width:100%;height:16px;background:#6366F1;z-index:5}.purple-side-bar{position:absolute;top:0;left:0;width:12px;height:100%;background:#6366F1;z-index:5}.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(99,102,241,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.07) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.grid-bg-light{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.05) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:1}.purple-orb{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,0.25) 0%,transparent 70%);pointer-events:none;z-index:1}.purple-orb-top{position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.purple-orb-large{position:absolute;bottom:-300px;right:-300px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,0.2) 0%,transparent 70%);pointer-events:none;z-index:1}.light-orb{position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:rgba(99,102,241,0.08);pointer-events:none;z-index:1}.dark-orb-bottom{position:absolute;bottom:-300px;left:-300px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,0.3) 0%,transparent 70%);pointer-events:none;z-index:1}.quote-deco-bg{position:absolute;top:60px;right:60px;font-size:500px;line-height:0.6;opacity:0.1;font-family:Georgia,serif;font-weight:900;color:white;pointer-events:none;z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3;padding-top:8px}.light-header-style{padding-bottom:28px;border-bottom:3px solid #E5E5F5}.logo-group{display:flex;flex-direction:column;gap:4px}.brand-name{font-size:54px;font-weight:900;letter-spacing:4px;color:#6366F1;line-height:1;font-family:'Inter',sans-serif}.brand-name-dark{font-size:54px;font-weight:900;letter-spacing:4px;color:#1E1B4B;line-height:1;font-family:'Inter',sans-serif}.brand-sub{font-size:14px;font-weight:600;letter-spacing:4px;color:#A5B4FC}.brand-sub-purple{font-size:14px;font-weight:600;letter-spacing:4px;color:#6366F1}.brand-sub-white{font-size:14px;font-weight:600;letter-spacing:4px;color:rgba(255,255,255,0.9)}.badge-purple-border{background:rgba(99,102,241,0.15);border:2px solid #6366F1;padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-purple-solid{background:#6366F1;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-warning{background:#6366F1;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-glass{background:rgba(0,0,0,0.25);border:2px solid rgba(255,255,255,0.3);padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.title-block{position:relative;z-index:3}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}.purple-bar{width:36px;height:6px;background:#6366F1}.overline-purple{font-size:20px;color:#A5B4FC;font-weight:900;letter-spacing:4px}.overline-purple-light{font-size:20px;color:#6366F1;font-weight:900;letter-spacing:4px}.overline-purple-quote{font-size:24px;color:#A5B4FC;font-weight:900;letter-spacing:5px;margin-bottom:24px}.service-title{font-size:80px;font-weight:900;color:white;line-height:1.05;letter-spacing:-2.5px}.cheat-title-dark{font-size:80px;font-weight:900;color:#1E1B4B;line-height:1.05;letter-spacing:-2.5px}.purple-highlight{color:#6366F1}.service-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.block-left-purple{background:rgba(255,255,255,0.05);border-left:6px solid #6366F1;padding:22px 28px}.block-label{font-size:18px;color:#A5B4FC;font-weight:900;letter-spacing:3px;margin-bottom:8px}.block-text{font-size:28px;color:white;font-weight:700;line-height:1.35}.tag-row{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.tag-purple{background:rgba(99,102,241,0.18);padding:10px 20px;font-size:18px;color:white;font-weight:700;letter-spacing:0.5px}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.mega-stat{font-size:340px;font-weight:900;color:white;line-height:0.95;letter-spacing:-14px;margin-bottom:16px}.purple-suffix{color:#6366F1;font-size:200px}.stat-desc{font-size:40px;color:#CBD5E1;line-height:1.3;font-weight:500;max-width:900px}.badge-row{display:flex;gap:16px;margin-top:36px;flex-wrap:wrap}.trust-badge{background:rgba(99,102,241,0.15);border-left:6px solid #6366F1;padding:14px 24px;font-size:20px;color:white;font-weight:900;letter-spacing:2px}.tip-list-light{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card-light{background:white;border-left:8px solid #6366F1;padding:20px 26px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)}.tip-num-black{background:#1E1B4B;color:white;min-width:62px;height:62px;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main-dark{font-size:28px;color:#1E1B4B;font-weight:900;line-height:1.25}.tip-sub-dark{font-size:18px;color:#64748B;font-weight:500;line-height:1.3}.project-details{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.detail-row{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,0.04);border-left:6px solid #6366F1;padding:20px 26px}.detail-icon-purple{background:#6366F1;color:white;min-width:56px;height:56px;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center}.detail-text{font-size:26px;color:white;font-weight:600;line-height:1.3}.project-stats{display:flex;align-items:center;gap:32px;margin-top:8px;background:rgba(99,102,241,0.12);border:2px solid rgba(99,102,241,0.4);padding:24px 32px}.stat-block{flex:1}.stat-block-label{font-size:16px;color:#A5B4FC;font-weight:900;letter-spacing:3px;margin-bottom:6px}.stat-block-value{font-size:30px;color:white;font-weight:900;line-height:1.2}.stat-block-divider{width:2px;height:60px;background:rgba(99,102,241,0.4)}.stars-row{display:flex;gap:6px;margin-bottom:20px}.star{color:white;font-size:48px;font-weight:900}.testimonial-text{font-size:54px;font-weight:900;line-height:1.2;letter-spacing:-1.5px;color:white}.testimonial-sub{font-size:24px;opacity:0.9;margin-top:18px;font-weight:500;line-height:1.4}.author-block{display:flex;align-items:center;gap:18px}.author-circle{width:60px;height:60px;border-radius:50%;background:rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white}.author-info{display:flex;flex-direction:column}.author-name{font-size:22px;font-weight:900;color:white}.author-role{font-size:18px;opacity:0.85;color:white;font-weight:500}.warning-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.warn-block{background:rgba(255,255,255,0.05);border-left:6px solid #6366F1;padding:22px 28px}.consequence-block{background:rgba(99,102,241,0.15);border-left:6px solid #6366F1}.solution-block{background:rgba(34,197,94,0.12);border-left:6px solid #22C55E}.warn-label-purple{font-size:18px;color:#A5B4FC;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-label-green{font-size:18px;color:#4ADE80;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-text{font-size:26px;color:white;font-weight:700;line-height:1.35}.warn-text-white{font-size:26px;color:white;font-weight:700;line-height:1.35}.pro-tip-bar{background:rgba(99,102,241,0.2);padding:18px 24px;font-size:22px;color:white;font-weight:600;line-height:1.4;border:2px solid rgba(99,102,241,0.5);margin-top:8px}.pro-tip-label{color:#A5B4FC;font-weight:900;letter-spacing:2px;margin-right:8px}.quote-block-center{position:relative;z-index:3;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:880px}.purple-accent-bar{height:8px;width:80px;background:#6366F1;margin-bottom:24px}.quote-mega-text{font-size:96px;font-weight:900;line-height:1.05;letter-spacing:-3px;color:white;margin-bottom:28px}.quote-sub-text{font-size:32px;color:#CBD5E1;line-height:1.4;font-weight:500;max-width:780px}.since-block{display:flex;align-items:center;gap:14px}.since-number{font-size:80px;font-weight:900;color:#6366F1;line-height:1}.since-text{font-size:14px;font-weight:900;color:white;letter-spacing:2.5px;line-height:1.3}.contact-stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.contact-line{font-size:22px;color:white;font-weight:700;letter-spacing:1px}.contact-line-purple{font-size:18px;color:#A5B4FC;font-weight:700;letter-spacing:0.5px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;position:relative;z-index:3}.dark-footer{border-top:2px solid rgba(99,102,241,0.4)}.light-footer-style{border-top:3px solid #E5E5F5}.purple-card-footer{border-top:2px solid rgba(255,255,255,0.3)}.footer-light-text{font-size:20px;color:#94A3B8;letter-spacing:1px;font-weight:600}.footer-purple-strong{font-size:22px;color:#6366F1;font-weight:900;letter-spacing:0.5px}.footer-gray{font-size:20px;color:#64748B;font-weight:700;letter-spacing:0.5px}.url-light{font-size:20px;color:white;opacity:0.9;letter-spacing:1.5px;font-weight:600}
```

---

## 7. Module 5 - `util:SetVariable2` (`final_html`)

`name: "final_html"`, `scope: "roundtrip"`. Value verbatim:

```
{{switch(2.image_template; "service_card"; 4.tpl_service; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "project_card"; 4.tpl_project; "testimonial"; 4.tpl_testimonial; "warning_card"; 4.tpl_warning; "quote_card"; 4.tpl_quote)}}
```

No default arm.

---

## 8. Module 6 - `html-css-to-image:Image` (render)

| Field | Value |
|---|---|
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `device_scale` | `2` |
| `google_fonts` | `Inter` |
| `__IMTCONN__` | `[REDACTED]` |
| Connection label | `Sidewalk Repair NYC HTML/CSS to Image connection` |

Effective output raster: 2160 x 2160 px (1080 CSS px at 2x device scale).
Only `Inter` is fetched from Google Fonts. `Georgia` is referenced by
`.quote-deco-bg` but relies on the renderer's local serif fallback.

## 9. Module 7 - `html-css-to-image:GetImage` (fetch binary)

| Field | Value |
|---|---|
| `image_id` | `{{6.id}}` |
| `format` | `png` |
| `__IMTCONN__` | `[REDACTED]` |
| Connection label | `Sidewalk Repair NYC HTML/CSS to Image connection` |

Produces `7.image` (binary) and `7.fileName`.

---

## 10. Publishing modules

### Module 8 - `facebook-pages:UploadPhoto` (version 6)

| Field | Value |
|---|---|
| `page_id` | `[REDACTED]` |
| `message` | `{{3.result.facebook_post}}` |
| `data` | `{{7.image}}` |
| `fileName` | `{{7.fileName}}` |
| `__IMTCONN__` | `[REDACTED]` |
| Connection label | (personal Facebook connection, `facebook` app) |

### Module 9 - `linkedin:CreateCompanyImagePost` (version 2)

| Field | Value |
|---|---|
| `organization` | `[REDACTED]` (was a `urn:li:organization:<id>`) |
| `method` | `upload` |
| `title` | `{{3.result.topic}}` |
| `content` | `{{3.result.linkedin_post}}` |
| `altText` | `Sidewalks Repair NYC insights` (hardcoded) |
| `data` | `{{7.image}}` |
| `fileName` | `{{7.fileName}}` |
| `visibility` | `PUBLIC` |
| `feedDistribution` | `MAIN_FEED` |
| `isReshareDisabledByAuthor` | `false` |
| `__IMTCONN__` | `[REDACTED]` |
| Connection label | (personal LinkedIn connection, `linkedin2` app) |

**No Instagram, Threads, Pinterest, Twitter/X or Google Business module exists in
this scenario.** Two destinations only.

---

## 11. Filters, routers, error handlers, history lookups

| Concern | Present? | Detail |
|---|---|---|
| Filters between modules | No | Every `flow` entry lacks a `filter` key |
| Routers / branches | No | Single linear chain, `designer.orphans` empty |
| Error handler routes | No | No `onerror` directives on any module |
| Retry / break / resume | No | Only scenario-level `maxErrors: 3` |
| Data store read/write | No | No `datastore` module in the flow |
| Google Sheets logging | No | No `google-sheets` package in `usedPackages` |
| Recent-post history lookup | **No** | Nothing reads prior output |
| Dedupe / uniqueness check | **No** | Nothing compares against past topics |
| Webhook | No | `hookId: null` |

**This scenario has zero memory.** The only thing preventing repetition is
`temperature: 0.85` and the day-of-week rotation. Two consecutive Mondays can
produce the same `topic` and the same `service_focus` with nothing to detect it.
A rewrite that adds history/dedupe is adding a capability that does not exist
here, not reproducing one.

---

## 12. Hardcoded business constants

| Constant | Value | Where |
|---|---|---|
| Business name | `Sidewalks Repair NYC` | system prompt, every template `brand-sub` |
| Brand mark | `SRN` (text wordmark, `.brand-name`) | all 7 templates |
| Brand subtitle | `SIDEWALKS REPAIR NYC` (letterspaced) | all 7 templates |
| Logo image URL | **none exists** | logo is pure CSS text, no image asset |
| Phone | `(917) 207-5803` | system prompt; footers of tpl_service, tpl_stat, tpl_cheat, tpl_project, tpl_warning, tpl_quote |
| Email | `[REDACTED]` | system prompt; tpl_project footer |
| Website | `https://sidewalksrepairnyc.com/` (rendered as `sidewalksrepairnyc.com`, sometimes with a trailing `→`) | system prompt; tpl_stat, tpl_cheat, tpl_testimonial, tpl_quote |
| Address | `12115 103rd Avenue, Queens, NY 11419` | system prompt |
| Primary city | New York City, all 5 boroughs | system prompt |
| Boroughs | `Manhattan, Brooklyn, Queens, Bronx, Staten Island` | system prompt |
| Extended service area | `Yonkers, Mount Vernon, New Rochelle, White Plains, Westchester` | system prompt |
| Services (10) | `DOT Sidewalk Violation Removal`, `Concrete Sidewalk Repair`, `Sidewalk Replacement`, `Tree Root Damage Repair`, `Trip Hazard Removal & Leveling`, `ADA-Compliant Sidewalk Upgrades`, `New Sidewalk Installation`, `Curb Repair`, `Sidewalk Crack Filling & Sealing`, `Driveway Apron Repair` | system prompt |
| Positioning claim | `licensed and insured` | system prompt, tpl_stat badge `LICENSED & INSURED` |
| CTA (Facebook/LinkedIn) | phone, email, website on separate lines at end of every post | system prompt RULES |
| CTA (image) | footer strip: phone + website, or `Call (917) 207-5803` on tpl_cheat | templates |
| Hashtags | **not hardcoded**; prompt demands `4-7 NYC-relevant hashtags at end`, the model invents them each run | system prompt RULES |
| LinkedIn alt text | `Sidewalks Repair NYC insights` | module 9 |
| Recurring domain facts | 75-day DOT window, 4-inch concrete minimum, owner responsibility, permits first, licensed contractors only, "city bills triple cost" | `ifempty()` fallbacks in tpl_stat / tpl_cheat / tpl_warning |

### Static template chrome strings (not model-supplied)

`★ SERVICE`, `EXPERT SIDEWALK`, `THE PROBLEM`, `OUR SOLUTION`, `THE RESULT`,
`Serving NYC and Westchester`, `LICENSED & INSURED`, `SIDEWALK GUIDE`,
`▲` badge prefix, `◆ PROJECT`, `RECENT WORK`, `TIMELINE`, `RESULT`,
`★ 5-STAR REVIEW`, five `★` glyphs, `⚠ WARNING`, `COMMON MISTAKE`,
`THE MISTAKE`, `CONSEQUENCE`, `DO THIS INSTEAD`, `PRO TIP:`,
`Avoid costly mistakes`, `✦` badge prefix, `OUR APPROACH`,
`5` + `BOROUGHS SERVED DAILY`.

Note these contain glyphs (★ ▲ ◆ ⚠ ✦ ●) that the copy prompt forbids in post
text. The ban applies to post copy only, not to template chrome.

### Colour palette (all hexes in `shared_css`)

| Hex | Role in the design |
|---|---|
| `#1E1B4B` | Deep indigo. Dark card base + gradient endpoints, quote card solid bg, dark heading ink on light card, tip number chip |
| `#2D2766` | Mid indigo, 50% stop of the dark card gradient |
| `#6366F1` | Primary accent purple. Top bars, side bar, borders, highlights, brand wordmark, badges, footer strong text |
| `#4F46E5` | Purple card gradient 50% stop |
| `#3730A3` | Purple card gradient 100% stop |
| `#A5B4FC` | Light periwinkle. Overlines, block labels, brand subtitle on dark, secondary contact line |
| `#FAFAFC` | Light card background |
| `#E5E5F5` | Light card divider borders (header bottom, footer top) |
| `#CBD5E1` | Body text on dark (stat description, quote subtext) |
| `#94A3B8` | Muted footer text on dark |
| `#64748B` | Muted text on light (tip subtitle, footer gray) |
| `#22C55E` | Green, solution block left border only |
| `#4ADE80` | Green, "DO THIS INSTEAD" label only |
| `white` / `rgba(255,255,255,*)` | Primary ink on dark, glass fills, tip card bg |
| `rgba(0,0,0,*)` | Glass badge fill, avatar circle, dark orb, tip card shadow |

`rgba(99,102,241,*)` throughout is `#6366F1` at alpha (0.05 to 0.5).
`rgba(34,197,94,0.12)` is `#22C55E` at alpha.

### Typography

| Family | Loaded how | Used for |
|---|---|---|
| `Inter` | `google_fonts: "Inter"` on module 6; `font-family:'Inter',-apple-system,sans-serif` global | everything |
| `Georgia, serif` | not loaded, local fallback only | `.quote-deco-bg` decorative open-quote glyph on the testimonial card |

Weights used: 500, 600, 700, 800, 900. Display sizes: `.mega-stat` 340px,
`.purple-suffix` 200px, `.quote-deco-bg` 500px, `.quote-mega-text` 96px,
`.service-title` / `.cheat-title-dark` 80px, `.since-number` 80px,
`.testimonial-text` 54px, `.brand-name` 54px.

---

## 13. Migration notes

1. **Two switches, not one.** `content_type` and `image_template` are derived
   independently from the same day name. Their vocabularies do not match. Keep
   both if the downstream system uses `content_type` for anything, otherwise
   collapse to one lookup table.
2. **Neither switch has a default.** A non-English locale or an unexpected day
   string silently yields an empty template and an empty render.
3. **One LLM call does everything**: topic, service focus, two full post bodies
   and all 36 image fields, in a single `json_object` response capped at 2500
   tokens. On a cheatsheet day the model must return 5 tips plus 5 subtitles plus
   two post bodies inside that cap.
4. **Wasted output**: the model is told to return all 36 `image_data` keys every
   day, with roughly 30 of them as empty strings, because the schema is one flat
   object rather than a discriminated union on template.
5. **`ifempty()` fallbacks are load-bearing.** Every slot has a real content
   default, so a partial or empty model response still renders a plausible card.
   Any rewrite that drops the fallbacks introduces a blank-card failure mode that
   does not exist today.
6. **Array indexing is 1-based** (`get(...; 1)`), per Make convention.
7. **Two-step image render**: `Image` returns an id, `GetImage` converts it to a
   PNG binary. A direct renderer collapses this to one step.
8. **`device_scale: 2`** means the delivered asset is 2160 x 2160, not 1080.
9. **Schedule timezone mismatch** (see section 1) is the highest-risk behavioural
   difference in a port.
10. **No memory, no dedupe, no logging.** Nothing records what was published.
