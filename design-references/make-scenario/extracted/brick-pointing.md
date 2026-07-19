# Make.com scenario extraction — Makkah Brick Pointing NYC

Reference extraction for code migration. Source: Make.com scenario blueprint,
fetched via the Make MCP `scenarios_get` API.

> **Redaction note.** This file is committed to git. Every connection id,
> `__IMTCONN__` value, API key, token, webhook URL, Google Sheet id, datastore
> id, Facebook page id and **email address** has been replaced with the literal
> token `[REDACTED]`. That includes the *business* contact email, which appears
> both in the OpenAI system prompt and in one HTML template footer — it is a
> public business address, not a credential, but the redaction rule is applied
> literally. Everywhere `[REDACTED]` appears in an otherwise verbatim block, the
> original was one of those values and nothing else was altered.
>
> Prompt text, rhythm logic, HTML/CSS and business constants are preserved
> verbatim, because they are the point of this exercise.

---

## 1. Scenario identity and schedule

| Field | Value |
| --- | --- |
| Name | `Makkah Brick Pointing NYC - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9277678` |
| Team id | `2388544` |
| Folder | none (`folderId: null`) |
| Active | `true` |
| Created | `2026-05-22T17:13:01.377Z` |
| Last edit | `2026-06-25T12:00:53.255Z` |
| Created / updated by | Muhammad Talha Javed (`[REDACTED]`) |
| Trigger type | polling / scheduled (`metadata.instant: false`) |
| Hook | none (`hookId: null`) |
| Next execution (at fetch time) | `2026-07-20T09:00:00.000Z` |

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

- `interval: 900` = poll every 900 seconds (15 minutes).
- `days: [1,2,3,4,5,6,0]` = every day of the week (Make uses `0` = Sunday).
- `time: ["14:00","14:01"]` = a one-minute window, so in practice the scenario
  fires **once per day at 14:00 local team time**.

**Timezone: no explicit timezone field exists anywhere in the scenario payload.**
Make applies the *team* timezone, which is not returned by `scenarios_get`. It
can be derived: `nextExec` is `2026-07-20T09:00:00.000Z` and the restrict window
is `14:00`, so the team timezone is **UTC+5** (consistent with `Asia/Karachi`).
This is an inference from the two returned values, not a stated field. Any
migration must store the timezone explicitly rather than relying on an implicit
account-level setting.

### Scenario-level execution settings

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

`dlqCount: 0`, `allDlqCount: 0`, `isPaused: false`, `isinvalid: false`.

### Declared packages

```
builtin, util, openai-gpt-3, util, util, html-css-to-image,
html-css-to-image, facebook-pages, google-sheets, builtin
```

---

## 2. Module map (linear chain, no router)

| # | Module id | Type | Purpose |
| --- | --- | --- | --- |
| 1 | `1` | `builtin:BasicFeeder` | Single-bundle kick-off |
| 2 | `2` | `util:SetVariables` | Day / rhythm variables |
| 3 | `3` | `openai-gpt-3:CreateCompletion` | Content generation |
| 4 | `4` | `util:SetVariables` | Six HTML templates + shared CSS |
| 5 | `5` | `util:SetVariable2` | Template selection (`final_html`) |
| 6 | `6` | `html-css-to-image:Image` | Render request |
| 7 | `7` | `html-css-to-image:GetImage` | Fetch rendered PNG |
| 8 | `8` | `facebook-pages:UploadPhoto` | Publish |
| 9 | `9` | `google-sheets:makeAPICall` | Append log row |
| 9e | `12` | `builtin:Resume` | Error handler attached to module 9 |

There is **no router, no filter, no iterator, no aggregator** anywhere in the
flow. Designer coordinates run `x: 0 → 2400`, `y: 0`, with the error handler at
`x: 2400, y: 300`.

---

## 3. Module 1 — `builtin:BasicFeeder`

```json
{ "array": "[{\"trigger\":\"start\"}]" }
```

Emits exactly one bundle so the downstream chain runs once per scheduled fire.

---

## 4. Module 2 — `util:SetVariables` (rhythm)

`scope: "roundtrip"`. Four variables, full values verbatim.

### `day_of_week`

```
{{formatDate(now; "dddd")}}
```

### `content_type` — the day-of-week rotation (full expression, verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_spotlight"; "Tuesday"; "trust_stat"; "Wednesday"; "nyc_code_tip"; "Thursday"; "project_showcase"; "Friday"; "maintenance_tip"; "Saturday"; "pro_tip_warning"; "Sunday"; "brand_insight")}}
```

### `image_template` — the template rotation (full expression, verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "service_card"; "Tuesday"; "stat_card"; "Wednesday"; "cheatsheet"; "Thursday"; "project_card"; "Friday"; "cheatsheet"; "Saturday"; "warning_card"; "Sunday"; "quote_card")}}
```

### `log_time`

```
{{formatDate(now; "YYYY-MM-DD HH:mm")}}
```

### Resolved rhythm table

| Day | `content_type` | `image_template` |
| --- | --- | --- |
| Monday | `service_spotlight` | `service_card` |
| Tuesday | `trust_stat` | `stat_card` |
| Wednesday | `nyc_code_tip` | `cheatsheet` |
| Thursday | `project_showcase` | `project_card` |
| Friday | `maintenance_tip` | `cheatsheet` |
| Saturday | `pro_tip_warning` | `warning_card` |
| Sunday | `brand_insight` | `quote_card` |

Seven content types, **six** templates — `cheatsheet` is deliberately reused on
Wednesday and Friday. There is no fallback branch in either switch: an
unmatched day would yield an empty string, and module 5's switch would then
produce empty HTML.

---

## 5. Module 3 — `openai-gpt-3:CreateCompletion`

| Setting | Value |
| --- | --- |
| Method (`select`) | `chat` — "Create a Chat Completion (GPT and o1 models)" |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `2500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| Connection | `__IMTCONN__: [REDACTED]` (label "Pioneer OpenAI") |

No seed, no frequency/presence penalty, no stop sequence, no tools/functions.

### System prompt (verbatim)

```text
You are the Marketing Lead for Brick Pointing NYC, a family-run licensed and insured masonry company in NYC since 2003 serving all 5 boroughs plus Westchester.

BUSINESS:
- Phone: (718) 908-4716
- Email: [REDACTED]
- Website: https://brickpointing-nyc.com/
- Service areas: Manhattan, Brooklyn, Queens, Bronx, Staten Island, Westchester

SERVICES: Brick Pointing, Repointing, Tuck Pointing, Spot Pointing, Mortar Repair, Facade Restoration, Brownstone Restoration, Chimney Repair, Parapet Wall Repair, Stucco, Concrete, Block Work, Masonry Cleaning, Power Washing. We also guide clients through NYC DOB violations and permits.

RULES:
- First person as Brick Pointing NYC.
- NO emojis, no fancy symbols.
- NEVER use em-dashes or long dashes. Use commas, full stops or new lines.
- Plain numbered lists (1. 2. 3.). Use blank lines between paragraphs.
- HONESTY (never break): every claim must be TRUE and general. Never invent statistics, awards, project counts, client names or testimonials. Never quote prices. Only real masonry and NYC facts.
- NYC specific where natural (boroughs, brownstones, DOB, permits, winter freeze and thaw).
- The facebook_post ends with phone, email and website on separate lines, then 4 to 7 NYC relevant hashtags.
- NO double quotes inside any text value.

You MUST output valid JSON with the image_data fields for TODAY'S template FILLED with real short content (no placeholders, no dots, no empty strings for the active template).

TODAY: {{2.day_of_week}} | Content type: {{2.content_type}} | Template: {{2.image_template}}

For template = service_card: fill service_name, service_subtitle, problem_text, solution_text, result_text, tags (array of 3 short like Brownstones, Townhouses, Facades).
For template = stat_card: fill big_stat (use a REAL number such as 20 for years since 2003, or 5 for boroughs), stat_label, overline (1-2 words), badges (array of 3 like LICENSED, INSURED, FAMILY RUN).
For template = cheatsheet: fill title_line1, title_line2 (highlighted), category_tag, tips (array of 5 short), tip_subtitles (array of 5 short).
For template = project_card: fill project_type, project_location (a NYC area, general, no client name), detail_1, detail_2, detail_3, timeline (a job type word), result_highlight.
For template = warning_card: fill warning_title, highlight_word (1-2 words), mistake_description, consequence, solution_text_warning, pro_tip.
For template = quote_card: fill quote_part1 (first half), quote_part2 (second half highlighted), subquote, category_tag.
For OTHER templates' fields, use empty string "".

Keep image text SHORT (poster format). Real values only.

Output valid JSON:
{
 "topic": "3 to 5 word topic",
 "service_focus": "which service",
 "facebook_post": "150 to 260 words, warm and local for homeowners, blank lines between paragraphs, ends with contact lines and hashtags",
 "image_data": {
  "service_name": "", "service_subtitle": "", "problem_text": "", "solution_text": "", "result_text": "", "tags": [],
  "big_stat": "", "stat_label": "", "overline": "", "badges": [],
  "title_line1": "", "title_line2": "", "category_tag": "", "tips": [], "tip_subtitles": [],
  "project_type": "", "project_location": "", "detail_1": "", "detail_2": "", "detail_3": "", "timeline": "", "result_highlight": "",
  "warning_title": "", "highlight_word": "", "mistake_description": "", "consequence": "", "solution_text_warning": "", "pro_tip": "",
  "quote_part1": "", "quote_part2": "", "subquote": ""
 }
}

Fill ONLY the fields that match today's template ({{2.image_template}}) with REAL short text. Leave all other fields as empty strings.
```

(The single `[REDACTED]` on the Email line replaced the business contact address
at `contact@` on the business domain. The prompt otherwise stands unmodified.)

### User prompt (verbatim)

```text
Generate todays post for Brick Pointing NYC.

Day: {{2.day_of_week}}
Content type: {{2.content_type}}
Template: {{2.image_template}}

Fill the image_data fields for template {{2.image_template}} with REAL short text (no placeholders). Return JSON only.
```

---

## 6. The exact JSON output schema the prompt demands

Top level:

| Field | Type | Constraint stated in prompt |
| --- | --- | --- |
| `topic` | string | "3 to 5 word topic" |
| `service_focus` | string | "which service" |
| `facebook_post` | string | 150 to 260 words; warm and local for homeowners; blank lines between paragraphs; ends with contact lines then hashtags |
| `image_data` | object | see below |

`image_data` — 28 fields, grouped by the template that owns them. Every field
not owned by today's template must be the empty string `""` (or `[]` for
arrays).

**`service_card`**

| Field | Type | Constraint |
| --- | --- | --- |
| `service_name` | string | short |
| `service_subtitle` | string | short |
| `problem_text` | string | short |
| `solution_text` | string | short |
| `result_text` | string | short |
| `tags` | array | exactly 3 short items, "like Brownstones, Townhouses, Facades" |

**`stat_card`**

| Field | Type | Constraint |
| --- | --- | --- |
| `big_stat` | string | a REAL number, e.g. 20 (years since 2003) or 5 (boroughs) |
| `stat_label` | string | short |
| `overline` | string | 1–2 words |
| `badges` | array | exactly 3, "like LICENSED, INSURED, FAMILY RUN" |

**`cheatsheet`**

| Field | Type | Constraint |
| --- | --- | --- |
| `title_line1` | string | short |
| `title_line2` | string | short, rendered highlighted |
| `category_tag` | string | short |
| `tips` | array | exactly 5 short items |
| `tip_subtitles` | array | exactly 5 short items |

**`project_card`**

| Field | Type | Constraint |
| --- | --- | --- |
| `project_type` | string | short |
| `project_location` | string | a NYC area, general, **no client name** |
| `detail_1` | string | short |
| `detail_2` | string | short |
| `detail_3` | string | short |
| `timeline` | string | a job type word |
| `result_highlight` | string | short |

**`warning_card`**

| Field | Type | Constraint |
| --- | --- | --- |
| `warning_title` | string | short |
| `highlight_word` | string | 1–2 words |
| `mistake_description` | string | short |
| `consequence` | string | short |
| `solution_text_warning` | string | short |
| `pro_tip` | string | short |

**`quote_card`**

| Field | Type | Constraint |
| --- | --- | --- |
| `quote_part1` | string | first half of the quote |
| `quote_part2` | string | second half, rendered highlighted |
| `subquote` | string | short |
| `category_tag` | string | shared with `cheatsheet` |

Global copy constraints applied across all string fields: no emojis, no em
dashes or long dashes, no double quotes inside any text value, no invented
statistics / awards / project counts / client names / testimonials, no prices.

Schema drift worth noting for migration:

- `service_focus` is generated but **never consumed** by any downstream module.
- `category_tag` is listed under the `cheatsheet` group in the schema block but
  is also required by `quote_card`, so it is genuinely shared.
- The prompt's inline schema omits `category_tag` from the quote grouping order
  but the per-template instructions require it.

---

## 7. Module 4 — `util:SetVariables` (six HTML templates + shared CSS)

`scope: "roundtrip"`. Seven variables. All HTML is stored as a single line and
is reproduced verbatim below. Class attributes use single quotes throughout, so
nothing is escaped.

Every dynamic slot uses `ifempty(<openai field>; "<hardcoded fallback>")`, which
means **every template ships a complete hardcoded fallback poster** even if the
model returns nothing. Array access uses Make's 1-indexed `get(array; n)`.

### `tpl_service` (verbatim)

```html
<div class='card dark-card'><div class='blue-top-bar'></div><div class='grid-bg'></div><div class='blue-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>BRICK POINTING NYC</span></div><div class='badge-blue-border'>SERVICE</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>EXPERT MASONRY</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.service_name; "Brick Pointing")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.service_subtitle; "and Masonry")}}</span></h1></div><div class='service-blocks'><div class='block-left-blue'><div class='block-label'>THE PROBLEM</div><div class='block-text'>{{ifempty(3.result.image_data.problem_text; "Cracked mortar lets water into brick walls")}}</div></div><div class='block-left-blue'><div class='block-label'>OUR SOLUTION</div><div class='block-text'>{{ifempty(3.result.image_data.solution_text; "Expert repointing and restoration")}}</div></div><div class='block-left-blue'><div class='block-label'>THE RESULT</div><div class='block-text'>{{ifempty(3.result.image_data.result_text; "Strong durable brickwork that lasts")}}</div></div><div class='tag-row'><div class='tag-blue'>{{ifempty(get(3.result.image_data.tags; 1); "Brownstones")}}</div><div class='tag-blue'>{{ifempty(get(3.result.image_data.tags; 2); "Townhouses")}}</div><div class='tag-blue'>{{ifempty(get(3.result.image_data.tags; 3); "Facades")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Serving all 5 NYC boroughs</span><span class='footer-blue-strong'>(718) 908-4716</span></div></div>
```

Hardcoded in `tpl_service`: brand wordmark `Makkah` + `BRICK POINTING NYC`,
badge `SERVICE`, overline `EXPERT MASONRY`, block labels `THE PROBLEM` /
`OUR SOLUTION` / `THE RESULT`, footer `Serving all 5 NYC boroughs` and phone
`(718) 908-4716`, plus six fallback copy strings and three fallback tags.

### `tpl_stat` (verbatim)

```html
<div class='card dark-card'><div class='blue-top-bar'></div><div class='grid-bg'></div><div class='blue-orb-top'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>BRICK POINTING NYC</span></div><div class='badge-blue-border'>SINCE 2003</div></div><div class='stat-body'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>{{ifempty(3.result.image_data.overline; "EXPERIENCE")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.big_stat; "20")}}<span class='blue-suffix'>+</span></div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "Years restoring NYC brickwork across all 5 boroughs")}}</div><div class='badge-row'><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 1); "LICENSED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 2); "INSURED")}}</div><div class='trust-badge'>{{ifempty(get(3.result.image_data.badges; 3); "FAMILY RUN")}}</div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>(718) 908-4716</span><span class='footer-blue-strong'>brickpointing-nyc.com</span></div></div>
```

Hardcoded: badge `SINCE 2003`, the `+` suffix appended to whatever number the
model returns (so `big_stat` must never itself contain a `+`), phone, website
`brickpointing-nyc.com`.

### `tpl_cheat` (verbatim)

```html
<div class='card light-card'><div class='blue-top-bar'></div><div class='light-orb'></div><div class='header light-header-style'><div class='logo-group'><span class='brand-makkah-dark'>Makkah</span><span class='brand-sub-blue'>BRICK POINTING NYC</span></div><div class='badge-blue-solid'>{{ifempty(3.result.image_data.category_tag; "NYC TIPS")}}</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue-light'>MASONRY GUIDE</span></div><h1 class='cheat-title-dark'>{{ifempty(3.result.image_data.title_line1; "5 things to know about")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.title_line2; "brick pointing")}}</span></h1></div><div class='tip-list-light'><div class='tip-card-light'><div class='tip-num-black'>01</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 1); "Check mortar yearly")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "Catch small problems early")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>02</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 2); "Match the mortar type")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "Old buildings need lime mortar")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>03</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 3); "Know your DOB rules")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "Facade work can need permits")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>04</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 4); "Hire licensed masons")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "Avoid fines and poor work")}}</span></div></div><div class='tip-card-light'><div class='tip-num-black'>05</div><div class='tip-content'><span class='tip-main-dark'>{{ifempty(get(3.result.image_data.tips; 5); "Fix small cracks fast")}}</span><span class='tip-sub-dark'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "Water damage spreads quickly")}}</span></div></div></div><div class='card-footer light-footer-style'><span class='footer-gray'>Call (718) 908-4716</span><span class='footer-blue-strong'>brickpointing-nyc.com</span></div></div>
```

The only light-background template. Hardcoded: default badge `NYC TIPS`,
overline `MASONRY GUIDE`, tip numbers `01`–`05`, CTA `Call (718) 908-4716`,
website, and ten fallback tip strings. Tip count is structurally fixed at five.

### `tpl_project` (verbatim)

```html
<div class='card dark-card'><div class='blue-top-bar'></div><div class='grid-bg'></div><div class='blue-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>BRICK POINTING NYC</span></div><div class='badge-blue-border'>PROJECT</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>RECENT WORK</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.project_type; "Brownstone Restoration")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.project_location; "Brooklyn")}}</span></h1></div><div class='project-details'><div class='detail-row'><div class='detail-icon-blue'>01</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_1; "Full facade repointing")}}</div></div><div class='detail-row'><div class='detail-icon-blue'>02</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_2; "Historic mortar match")}}</div></div><div class='detail-row'><div class='detail-icon-blue'>03</div><div class='detail-text'>{{ifempty(3.result.image_data.detail_3; "Crack repair and sealing")}}</div></div><div class='project-stats'><div class='stat-block'><div class='stat-block-label'>TYPE</div><div class='stat-block-value'>{{ifempty(3.result.image_data.timeline; "Repointing")}}</div></div><div class='stat-block-divider'></div><div class='stat-block'><div class='stat-block-label'>RESULT</div><div class='stat-block-value'>{{ifempty(3.result.image_data.result_highlight; "Like new")}}</div></div></div></div><div class='card-footer dark-footer'><span class='footer-light-text'>[REDACTED]</span><span class='footer-blue-strong'>(718) 908-4716</span></div></div>
```

The `[REDACTED]` in the footer replaced the business contact email address.
Hardcoded: badge `PROJECT`, overline `RECENT WORK`, detail numbers `01`–`03`,
stat labels `TYPE` / `RESULT`, phone.

### `tpl_warning` (verbatim)

```html
<div class='card dark-card'><div class='blue-top-bar-thick'></div><div class='grid-bg'></div><div class='blue-orb'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>BRICK POINTING NYC</span></div><div class='badge-warning'>WARNING</div></div><div class='title-block'><div class='overline-row'><div class='blue-bar'></div><span class='overline-blue'>COMMON MISTAKE</span></div><h1 class='service-title'>{{ifempty(3.result.image_data.warning_title; "Avoid this costly")}}<br><span class='blue-highlight'>{{ifempty(3.result.image_data.highlight_word; "masonry mistake")}}</span></h1></div><div class='warning-blocks'><div class='warn-block'><div class='warn-label-blue'>THE MISTAKE</div><div class='warn-text'>{{ifempty(3.result.image_data.mistake_description; "Using the wrong mortar on historic brick")}}</div></div><div class='warn-block consequence-block'><div class='warn-label-blue'>CONSEQUENCE</div><div class='warn-text'>{{ifempty(3.result.image_data.consequence; "Cracking, water damage, costly repairs")}}</div></div><div class='warn-block solution-block'><div class='warn-label-green'>DO THIS INSTEAD</div><div class='warn-text-white'>{{ifempty(3.result.image_data.solution_text_warning; "Hire experts who match the original mortar")}}</div></div><div class='pro-tip-bar'><span class='pro-tip-label'>PRO TIP</span>{{ifempty(3.result.image_data.pro_tip; "Inspect mortar yearly to catch problems early")}}</div></div><div class='card-footer dark-footer'><span class='footer-light-text'>Avoid costly mistakes</span><span class='footer-blue-strong'>(718) 908-4716</span></div></div>
```

Hardcoded: badge `WARNING`, overline `COMMON MISTAKE`, labels `THE MISTAKE` /
`CONSEQUENCE` / `DO THIS INSTEAD` / `PRO TIP`, footer `Avoid costly mistakes`,
phone. This is the only template that introduces green (`#22C55E`, `#4ADE80`).

### `tpl_quote` (verbatim)

```html
<div class='card black-quote-card'><div class='grid-bg'></div><div class='blue-side-bar'></div><div class='blue-orb-large'></div><div class='header'><div class='logo-group'><span class='brand-makkah'>Makkah</span><span class='brand-sub'>BRICK POINTING NYC</span></div><div class='badge-blue-border'>{{ifempty(3.result.image_data.category_tag; "OUR PROMISE")}}</div></div><div class='quote-block-center'><div class='blue-accent-bar'></div><div class='overline-blue-quote'>OUR APPROACH</div><div class='quote-mega-text'>{{ifempty(3.result.image_data.quote_part1; "Old buildings need")}} <span class='blue-highlight'>{{ifempty(3.result.image_data.quote_part2; "old-world care")}}</span></div><div class='quote-sub-text'>{{ifempty(3.result.image_data.subquote; "We treat every NYC brownstone like our own family home.")}}</div></div><div class='card-footer dark-footer'><div class='since-block'><div class='since-number'>20+</div><div class='since-text'>YEARS<br>MASTER MASONS</div></div><div class='contact-stack'><span class='contact-line'>(718) 908-4716</span><span class='contact-line-blue'>brickpointing-nyc.com</span></div></div></div>
```

Hardcoded: default badge `OUR PROMISE`, overline `OUR APPROACH`, footer stat
`20+` with `YEARS / MASTER MASONS`, phone, website. The `20+` is a **frozen
literal**, unlike `stat_card` where the number is model-supplied — a migration
must decide whether that becomes `currentYear - foundingYear`.

### `shared_css` (verbatim)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.dark-card{background:linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#0F172A 100%);color:white}.light-card{background:#F8FAFC;color:#0F172A;gap:32px;justify-content:flex-start}.black-quote-card{background:#0F172A;color:white;justify-content:center}.blue-top-bar{position:absolute;top:0;left:0;width:100%;height:12px;background:#1E90FF;z-index:5}.blue-top-bar-thick{position:absolute;top:0;left:0;width:100%;height:16px;background:#1E90FF;z-index:5}.blue-side-bar{position:absolute;top:0;left:0;width:12px;height:100%;background:#1E90FF;z-index:5}.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(30,144,255,0.07) 1px,transparent 1px),linear-gradient(90deg,rgba(30,144,255,0.07) 1px,transparent 1px);background-size:60px 60px;z-index:1}.blue-orb{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(30,144,255,0.25) 0%,transparent 70%);z-index:1}.blue-orb-top{position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(30,144,255,0.3) 0%,transparent 70%);z-index:1}.blue-orb-large{position:absolute;bottom:-300px;right:-300px;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(30,144,255,0.2) 0%,transparent 70%);z-index:1}.light-orb{position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:rgba(30,144,255,0.08);z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3;padding-top:8px}.light-header-style{padding-bottom:28px;border-bottom:3px solid #E2E8F0}.logo-group{display:flex;flex-direction:column;gap:4px}.brand-makkah{font-size:54px;font-weight:700;letter-spacing:2px;color:white;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-makkah-dark{font-size:54px;font-weight:700;letter-spacing:2px;color:#0F172A;font-style:italic;line-height:1;font-family:Georgia,serif}.brand-sub{font-size:14px;font-weight:600;letter-spacing:4px;color:#60A5FA}.brand-sub-blue{font-size:14px;font-weight:600;letter-spacing:4px;color:#1E90FF}.badge-blue-border{background:rgba(30,144,255,0.15);border:2px solid #1E90FF;padding:10px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-blue-solid{background:#1E90FF;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.badge-warning{background:#1E90FF;padding:11px 22px;font-size:16px;color:white;font-weight:800;letter-spacing:2.5px}.title-block{position:relative;z-index:3}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}.blue-bar{width:36px;height:6px;background:#1E90FF}.overline-blue{font-size:20px;color:#60A5FA;font-weight:900;letter-spacing:4px}.overline-blue-light{font-size:20px;color:#1E90FF;font-weight:900;letter-spacing:4px}.overline-blue-quote{font-size:24px;color:#60A5FA;font-weight:900;letter-spacing:5px;margin-bottom:24px}.service-title{font-size:80px;font-weight:900;color:white;line-height:1.05;letter-spacing:-2.5px}.cheat-title-dark{font-size:80px;font-weight:900;color:#0F172A;line-height:1.05;letter-spacing:-2.5px}.blue-highlight{color:#1E90FF}.service-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.block-left-blue{background:rgba(255,255,255,0.05);border-left:6px solid #1E90FF;padding:22px 28px}.block-label{font-size:18px;color:#60A5FA;font-weight:900;letter-spacing:3px;margin-bottom:8px}.block-text{font-size:28px;color:white;font-weight:700;line-height:1.35}.tag-row{display:flex;gap:14px;margin-top:8px;flex-wrap:wrap}.tag-blue{background:rgba(30,144,255,0.18);padding:10px 20px;font-size:18px;color:white;font-weight:700;letter-spacing:0.5px}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.mega-stat{font-size:340px;font-weight:900;color:white;line-height:0.95;letter-spacing:-14px;margin-bottom:16px}.blue-suffix{color:#1E90FF}.stat-desc{font-size:40px;color:#CBD5E1;line-height:1.3;font-weight:500;max-width:900px}.badge-row{display:flex;gap:16px;margin-top:36px;flex-wrap:wrap}.trust-badge{background:rgba(30,144,255,0.15);border-left:6px solid #1E90FF;padding:14px 24px;font-size:20px;color:white;font-weight:900;letter-spacing:2px}.tip-list-light{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card-light{background:white;border-left:8px solid #1E90FF;padding:20px 26px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.06)}.tip-num-black{background:#0F172A;color:white;min-width:62px;height:62px;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main-dark{font-size:28px;color:#0F172A;font-weight:900;line-height:1.25}.tip-sub-dark{font-size:18px;color:#64748B;font-weight:500;line-height:1.3}.project-details{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.detail-row{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,0.04);border-left:6px solid #1E90FF;padding:20px 26px}.detail-icon-blue{background:#1E90FF;color:white;min-width:56px;height:56px;font-size:22px;font-weight:900;display:flex;align-items:center;justify-content:center}.detail-text{font-size:26px;color:white;font-weight:600;line-height:1.3}.project-stats{display:flex;align-items:center;gap:32px;margin-top:8px;background:rgba(30,144,255,0.12);border:2px solid rgba(30,144,255,0.4);padding:24px 32px}.stat-block{flex:1}.stat-block-label{font-size:16px;color:#60A5FA;font-weight:900;letter-spacing:3px;margin-bottom:6px}.stat-block-value{font-size:30px;color:white;font-weight:900;line-height:1.2}.stat-block-divider{width:2px;height:60px;background:rgba(30,144,255,0.4)}.warning-blocks{display:flex;flex-direction:column;gap:18px;position:relative;z-index:3}.warn-block{background:rgba(255,255,255,0.05);border-left:6px solid #1E90FF;padding:22px 28px}.consequence-block{background:rgba(30,144,255,0.15);border-left:6px solid #1E90FF}.solution-block{background:rgba(34,197,94,0.12);border-left:6px solid #22C55E}.warn-label-blue{font-size:18px;color:#60A5FA;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-label-green{font-size:18px;color:#4ADE80;font-weight:900;letter-spacing:3px;margin-bottom:8px}.warn-text{font-size:26px;color:white;font-weight:700;line-height:1.35}.warn-text-white{font-size:26px;color:white;font-weight:700;line-height:1.35}.pro-tip-bar{background:rgba(30,144,255,0.2);padding:18px 24px;font-size:22px;color:white;font-weight:600;line-height:1.4;border:2px solid rgba(30,144,255,0.5);margin-top:8px}.pro-tip-label{color:#60A5FA;font-weight:900;letter-spacing:2px;margin-right:8px}.quote-block-center{position:relative;z-index:3;flex:1;display:flex;flex-direction:column;justify-content:center;max-width:880px}.blue-accent-bar{height:8px;width:80px;background:#1E90FF;margin-bottom:24px}.quote-mega-text{font-size:96px;font-weight:900;line-height:1.05;letter-spacing:-3px;color:white;margin-bottom:28px}.quote-sub-text{font-size:32px;color:#CBD5E1;line-height:1.4;font-weight:500;max-width:780px}.since-block{display:flex;align-items:center;gap:14px}.since-number{font-size:80px;font-weight:900;color:#1E90FF;line-height:1}.since-text{font-size:14px;font-weight:900;color:white;letter-spacing:2.5px;line-height:1.3}.contact-stack{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.contact-line{font-size:22px;color:white;font-weight:700;letter-spacing:1px}.contact-line-blue{font-size:18px;color:#60A5FA;font-weight:700;letter-spacing:0.5px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;position:relative;z-index:3}.dark-footer{border-top:2px solid rgba(30,144,255,0.4)}.light-footer-style{border-top:3px solid #E2E8F0}.footer-light-text{font-size:20px;color:#94A3B8;letter-spacing:1px;font-weight:600}.footer-blue-strong{font-size:22px;color:#1E90FF;font-weight:900;letter-spacing:0.5px}.footer-gray{font-size:20px;color:#64748B;font-weight:700;letter-spacing:0.5px}
```

#### Where colour, font and business constants appear in the CSS

| Token | Value | Used by |
| --- | --- | --- |
| Primary accent | `#1E90FF` (dodger blue) | top/side bars, highlights, badges, all left borders, footer strong text, since-number, accent bars, suffix |
| Accent tint | `#60A5FA` | overlines, block labels, brand sub-line, contact-line-blue, pro-tip label |
| Ink / dark field | `#0F172A` | dark-card gradient stops, quote card background, light-card text, tip-num block |
| Dark gradient mid | `#1E293B` | dark-card `linear-gradient(135deg, …50%…)` |
| Light field | `#F8FAFC` | light-card background |
| Light border | `#E2E8F0` | light header/footer rules |
| Muted light text | `#CBD5E1` | stat-desc, quote-sub-text |
| Footer gray | `#94A3B8` | footer-light-text |
| Muted gray | `#64748B` | tip-sub-dark, footer-gray |
| Success green | `#22C55E` border, `#4ADE80` label, `rgba(34,197,94,0.12)` fill | warning card solution block only |
| Plain white | `white` / `rgba(255,255,255,0.04–0.05)` | body copy, block fills, tip cards |
| Accent alpha ramp | `rgba(30,144,255, .07 / .08 / .12 / .15 / .18 / .2 / .25 / .3 / .4 / .5)` | grid, orbs, badges, tags, blocks, borders |
| Body font | `'Inter', -apple-system, sans-serif` | global `*` rule; supplied to the renderer as `google_fonts: "Inter"` |
| Wordmark font | `Georgia, serif`, italic, 700 | `.brand-makkah` and `.brand-makkah-dark` only |

**There is no logo URL and no image asset anywhere in the scenario.** The logo
is rendered purely as text: the word `Makkah` in italic Georgia at 54px over a
4px-letterspaced `BRICK POINTING NYC` in `#60A5FA` (dark cards) or `#1E90FF`
(light card). Nothing is fetched from a CDN.

Canvas is fixed at `1080px × 1080px` with `80px` padding in `.card`.

---

## 8. Module 5 — `util:SetVariable2` (template selection)

Variable `final_html`, `scope: "roundtrip"`. Full value verbatim:

```
{{switch(2.image_template; "service_card"; 4.tpl_service; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "project_card"; 4.tpl_project; "warning_card"; 4.tpl_warning; "quote_card"; 4.tpl_quote)}}
```

No default branch.

---

## 9. Module 6 — `html-css-to-image:Image` (render)

| Setting | Value |
| --- | --- |
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `google_fonts` | `Inter` |
| `device_scale` | `2` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `selector` | **not set** — no selector parameter exists in the mapper |
| Connection | `__IMTCONN__: [REDACTED]` (label "Brick Pointing HTML/CSS to Image connection") |

Effective output: 1080 × 1080 CSS pixels at `device_scale: 2`, i.e. a
**2160 × 2160 px** PNG. Because no `selector` is given, the renderer captures the
full viewport rather than the `.card` element; the card is sized to exactly the
viewport so the two coincide.

## 10. Module 7 — `html-css-to-image:GetImage`

| Setting | Value |
| --- | --- |
| `image_id` | `{{6.id}}` |
| `format` | `png` |
| Connection | `__IMTCONN__: [REDACTED]` (same connection as module 6) |

Produces `{{7.image}}` (binary buffer) and `{{7.fileName}}`.

---

## 11. Module 8 — `facebook-pages:UploadPhoto` (publish)

| Setting | Value |
| --- | --- |
| Module version | `6` |
| `page_id` | `[REDACTED]` (label "Brick Pointing NYC (Queens)") |
| `fileName` | `{{7.fileName}}` |
| `data` | `{{7.image}}` |
| `message` | `{{3.result.facebook_post}}` |
| Connection | `__IMTCONN__: [REDACTED]` |

Posts the rendered PNG as a Facebook Page photo with the generated
`facebook_post` as the caption.

**This is the only publishing module in the scenario.** Despite the scenario
name saying "(Multi-Platform)" there is no Instagram, Threads, LinkedIn,
Pinterest, X or Google Business module anywhere in the flow, and `usedPackages`
confirms it. No Instagram account id, LinkedIn org id or Pinterest board id
exists in this blueprint to redact.

---

## 12. Module 9 — `google-sheets:makeAPICall` (log write)

| Setting | Value |
| --- | --- |
| `method` | `POST` |
| `url` | `/spreadsheets/[REDACTED]/values/Log!A:D:append` |
| `headers` | `[]` |
| `showAdvancedSettings` | `false` |
| Connection | `__IMTCONN__: [REDACTED]` (label `[REDACTED]`, a Gmail account) |

Query string:

| Key | Value |
| --- | --- |
| `valueInputOption` | `USER_ENTERED` |
| `insertDataOption` | `INSERT_ROWS` |

Body (verbatim, with the sheet id already redacted out of the URL above):

```
{"values":[["{{2.log_time}}","{{2.content_type}}","{{3.result.topic}}","{{8.post_id}}"]]}
```

Sheet tab `Log`, columns `A:D`:

| Column | Source |
| --- | --- |
| A | `2.log_time` — `YYYY-MM-DD HH:mm` |
| B | `2.content_type` — today's rotation slot |
| C | `3.result.topic` — the model's 3–5 word topic |
| D | `8.post_id` — Facebook post id returned by the publish step |

**This is append-only. Nothing in the scenario ever reads it back.**

---

## 13. Filters, routers, error handling, retries, history

| Concern | Present? | Detail |
| --- | --- | --- |
| Filters between modules | No | None anywhere in the flow |
| Router / branching | No | Strictly linear chain 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 |
| Iterator / aggregator | No | — |
| Error handlers | One | `builtin:Resume` (module id `12`) attached to module 9's `onerror`, mapper `{ "output": {} }`. A Google Sheets logging failure is swallowed and the cycle completes. |
| Retry routes / `builtin:Break` | No | No `Break`, no `Ignore`, no rollback, no commit handlers |
| Error handling on OpenAI / render / Facebook | **No** | Modules 3, 6, 7 and 8 have no `onerror` at all. A failure there aborts the cycle and counts toward `maxErrors: 3`. |
| Datastore usage | No | No `datastore` module; nothing to redact |
| **History lookup** | **No** | The Google Sheet is written to only, via `:append`. The scenario never reads previous rows, never queries the sheet, and never passes prior topics into the prompt. |
| Duplicate prevention | **None** | The only anti-repetition mechanism is the day-of-week rotation plus `temperature: 0.85`. Nothing prevents the model from producing the same topic on the same weekday week after week. |

---

## 14. Every hardcoded business constant

### Identity

| Constant | Value | Where |
| --- | --- | --- |
| Legal / prompt business name | `Brick Pointing NYC` | system prompt, user prompt |
| Display wordmark | `Makkah` | all six HTML templates (`.brand-makkah` / `.brand-makkah-dark`) |
| Display sub-lockup | `BRICK POINTING NYC` | all six HTML templates (`.brand-sub` / `.brand-sub-blue`) |
| Scenario-level brand string | `Makkah Brick Pointing NYC` | scenario name |
| Positioning | family-run, licensed and insured masonry company | system prompt |
| Founding year | `2003` | system prompt; `SINCE 2003` badge in `tpl_stat` |
| Tenure claim | `20+` years / `20` default `big_stat` | `tpl_quote` (frozen literal `20+`), `tpl_stat` fallback |

### Contact

| Constant | Value | Where |
| --- | --- | --- |
| Phone | `(718) 908-4716` | system prompt; footers of all six templates (twice in `tpl_cheat` context as `Call (718) 908-4716`) |
| Email | `[REDACTED]` (a `contact@` address on the business domain) | system prompt; `tpl_project` footer |
| Website (full) | `https://brickpointing-nyc.com/` | system prompt |
| Website (display) | `brickpointing-nyc.com` | `tpl_stat`, `tpl_cheat`, `tpl_quote` footers |

### Geography

| Constant | Value |
| --- | --- |
| Service areas (prompt) | Manhattan, Brooklyn, Queens, Bronx, Staten Island, Westchester |
| Coverage phrasing | "all 5 boroughs plus Westchester" (prompt), `Serving all 5 NYC boroughs` (`tpl_service` footer), `across all 5 boroughs` (`tpl_stat` fallback) |
| Default project location | `Brooklyn` (`tpl_project` fallback) |
| Local-context cues | boroughs, brownstones, DOB, permits, winter freeze and thaw |

### Services (14, verbatim order from the prompt)

```
Brick Pointing, Repointing, Tuck Pointing, Spot Pointing, Mortar Repair,
Facade Restoration, Brownstone Restoration, Chimney Repair,
Parapet Wall Repair, Stucco, Concrete, Block Work, Masonry Cleaning,
Power Washing
```

Plus: "We also guide clients through NYC DOB violations and permits."

### CTA / footer / chrome strings baked into the templates

| String | Template |
| --- | --- |
| `Serving all 5 NYC boroughs` | `tpl_service` |
| `Call (718) 908-4716` | `tpl_cheat` |
| `Avoid costly mistakes` | `tpl_warning` |
| `20+` / `YEARS` / `MASTER MASONS` | `tpl_quote` |
| Badges: `SERVICE`, `SINCE 2003`, `PROJECT`, `WARNING`; defaults `NYC TIPS`, `OUR PROMISE` | one per template |
| Overlines: `EXPERT MASONRY`, `EXPERIENCE` (default), `MASONRY GUIDE`, `RECENT WORK`, `COMMON MISTAKE`, `OUR APPROACH` | one per template |
| Section labels: `THE PROBLEM`, `OUR SOLUTION`, `THE RESULT`, `THE MISTAKE`, `CONSEQUENCE`, `DO THIS INSTEAD`, `PRO TIP`, `TYPE`, `RESULT` | service / warning / project |
| Ordinals: `01`–`05` (cheatsheet), `01`–`03` (project) | fixed list lengths |
| Trust badge defaults: `LICENSED`, `INSURED`, `FAMILY RUN` | `tpl_stat` |
| Tag defaults: `Brownstones`, `Townhouses`, `Facades` | `tpl_service` |

### Hashtags

**Not hardcoded.** The system prompt instructs the model to end
`facebook_post` with "4 to 7 NYC relevant hashtags" after the phone, email and
website lines. There is no hashtag constant, no bank, and no validation that the
count lands in range.

### Brand colours

Primary `#1E90FF`. Tint `#60A5FA`. Ink `#0F172A`. Gradient mid `#1E293B`.
Light field `#F8FAFC`. Light border `#E2E8F0`. Muted `#CBD5E1`, `#94A3B8`,
`#64748B`. Success `#22C55E` / `#4ADE80`. Plus `white` and the
`rgba(30,144,255, α)` alpha ramp. Full mapping in section 7.

### Fonts

`Inter` (loaded via the renderer's `google_fonts: "Inter"`, fallbacks
`-apple-system, sans-serif`) for everything except the wordmark, which is
`Georgia, serif` italic 700.

### Logo

None. No URL, no image asset, no CDN reference anywhere in the scenario. The
mark is CSS text.

---

## 15. Migration notes

1. **Timezone is implicit.** Nothing in the blueprint states it; it lives in the
   Make team setting. Derived as UTC+5 from `nextExec`. Must become explicit.
2. **No history, no duplicate prevention.** The Sheets call is append-only. A
   migration that wants non-repeating content has to add the read side.
3. **`service_focus` is dead output** — generated, never consumed.
4. **Seven content types, six templates**, with `cheatsheet` doubling on
   Wednesday and Friday. The `content_type` and `image_template` switches are
   independent expressions, so they can drift out of sync.
5. **Neither switch has a default branch.** An unmatched day silently yields an
   empty string and then empty HTML.
6. **Fallbacks are load-bearing.** Every dynamic slot has an `ifempty()` default,
   so a total model failure still renders a complete, on-brand poster. That is
   the closest thing to error handling on the creative path.
7. **Error handling is asymmetric.** Only the logging step is protected
   (`Resume`); OpenAI, both render calls and the Facebook publish are unguarded
   against `maxErrors: 3`.
8. **Fixed list lengths.** `tips` / `tip_subtitles` must be exactly 5, `tags`
   and `badges` exactly 3, project details exactly 3. The HTML has no loop.
9. **`stat_card` appends `+`** to the model's number in markup, so `big_stat`
   must be a bare numeral. `tpl_quote`'s `20+` is frozen and will go stale.
10. **"(Multi-Platform)" is aspirational** — only Facebook Pages publishes.
11. Content instruction sizes: `facebook_post` 150–260 words; all image copy is
    explicitly "SHORT (poster format)".
12. The honesty rules and the em-dash ban in this prompt align with the Cyflow
    Social copy rules already in `CLAUDE.md`.
