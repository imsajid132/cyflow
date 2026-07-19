# Make.com Scenario Extraction — Peralytics AI SEO (Multi-Platform)

Reference extraction for code migration. Captured from the live Make blueprint plus
the live data store definition and its current record.

**Redaction note:** per policy, every connection id, `__IMTCONN__` value, data store
id, data structure id, Facebook page id, LinkedIn organization id, Instagram account
id, Pinterest board id and **every email address** has been replaced with the literal
token `[REDACTED]`. Connection *labels* are kept only where they carry no address; the
account-name suffix on two labels was an email local part and is redacted.
Everything else (prompt text, rhythm logic, HTML/CSS, colours, fonts, domain, CTA
strings, hashtag lists) is verbatim.

**This is the only scenario in the set with a Make DATA STORE.** Section 11 documents
that history mechanism in full; it is the duplicate-prevention design.

---

## 1. Scenario identity and schedule

| Field | Value |
| --- | --- |
| Name | `Peralytics AI SEO - Daily Content Generator (Multi-Platform)` |
| Scenario id | `9245183` |
| Team id | `2388544` |
| Folder | none (`folderId: null`) |
| Active | `true` (`isActive: true`, `isPaused: false`, `isinvalid: false`) |
| Created | `2026-05-16T23:16:54.730Z` |
| Last edit | `2026-07-01T02:08:33.394Z` |
| Next exec (at capture) | `2026-07-20T08:00:00.000Z` |
| Created / updated by | `Muhammad Talha Javed` <[REDACTED]> |
| Trigger type | polling / scheduled (`metadata.instant: false`), no hook (`hookId: null`) |
| DLQ | `dlqCount: 0`, `allDlqCount: 0`, `dlq: false` |

### Scheduling block (verbatim)

```json
{
  "type": "indefinitely",
  "interval": 900,
  "restrict": [
    {
      "days": [1, 2, 3, 4, 5, 6, 0],
      "time": ["13:00", "13:01"]
    }
  ]
}
```

- `interval: 900` = 900 seconds (15 minutes) between polls.
- `restrict.days` `[1,2,3,4,5,6,0]` = Make weekday numbering `0 = Sunday … 6 = Saturday`,
  so **all seven days** are enabled.
- `restrict.time` `["13:00", "13:01"]` = a **one-minute window at 13:00 local**. Combined
  with the 15-minute poll interval this fires effectively **once per day**.
- **No `timezone` key is present** on the scenario or the blueprint — it inherits the
  Make organization/team timezone. Circumstantial evidence: the captured `nextExec` of
  `08:00:00Z` for a `13:00` local slot implies the inherited zone is **UTC+5**
  (consistent with `Asia/Karachi`). This is inferred, not declared, and must be made
  explicit on migration.
- This scenario fires **one hour earlier** than the contractor scenarios (13:00 vs 14:00).

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

### Module flow (13 modules, strictly linear — no branches)

All modules sit on `y: 0`; `x` increases monotonically. There is no router, no filter
and no error handler anywhere in the flow.

| # | Module id | Module | Designer x | Role |
| --- | --- | --- | --- | --- |
| 1 | `1` | `builtin:BasicFeeder` | 0 | one-bundle trigger |
| 2 | `2` | `util:SetVariables` | 300 | rhythm (day / content_type / image_template) |
| 3 | `13` | `datastore:GetRecord` | 450 | **read post history** |
| 4 | `3` | `openai-gpt-3:CreateCompletion` | 600 | content generation |
| 5 | `4` | `util:SetVariables` | 900 | 4 HTML templates + shared CSS |
| 6 | `5` | `util:SetVariable2` | 1200 | template selection |
| 7 | `6` | `html-css-to-image:Image` | 1500 | render |
| 8 | `7` | `html-css-to-image:GetImage` | 1800 | fetch binary |
| 9 | `8` | `facebook-pages:UploadPhoto` | 2100 | publish |
| 10 | `9` | `linkedin:CreateCompanyImagePost` | 2400 | publish |
| 11 | `10` | `instagram-business:CreatePostPhoto` | 2700 | publish |
| 12 | `12` | `pinterest:createPin` | 3000 | publish |
| 13 | `14` | `datastore:AddRecord` | 3300 | **write post history** |

**Module id `11` is absent from the flow.** `usedPackages` has exactly 13 entries and
none is a Twitter/X app, so the gap is a deleted module, not an unlisted one. The
consequence is section 10's headline defect: `twitter_post` is generated on every run
and never published anywhere.

---

## 2. Module 1 — `builtin:BasicFeeder`

```json
{
  "id": 1,
  "module": "builtin:BasicFeeder",
  "version": 1,
  "mapper": { "array": "[{\"trigger\":\"start\"}]" },
  "parameters": {}
}
```

A one-element literal array, so the chain runs exactly once per scheduled fire. The
`trigger: "start"` value is never read downstream. Migration equivalent: a plain cron
entry point.

---

## 3. Module 2 — `util:SetVariables` (rhythm)

`scope: "roundtrip"`. Three variables, all derived from `now` at run time.

### `day_of_week`

```
{{formatDate(now; "dddd")}}
```

Full English weekday name (`Monday` … `Sunday`). Formatted in the inherited scenario
timezone, which is the same unstated zone flagged in section 1.

### `content_type` — full rotation expression (verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "educational_tip"; "Tuesday"; "geo_insight"; "Wednesday"; "hot_take_myth"; "Thursday"; "how_to_guide"; "Friday"; "industry_trend"; "Saturday"; "quick_hack"; "Sunday"; "thought_leadership")}}
```

### `image_template` — full rotation expression (verbatim)

```
{{switch(formatDate(now; "dddd"); "Monday"; "cheatsheet"; "Tuesday"; "quote_card"; "Wednesday"; "comparison"; "Thursday"; "cheatsheet"; "Friday"; "quote_card"; "Saturday"; "cheatsheet"; "Sunday"; "quote_card")}}
```

Both switches are exhaustive over the seven weekday names, so the trailing default arm
of `switch()` is never reached.

### Resolved weekly rhythm

| Day | `content_type` | `image_template` |
| --- | --- | --- |
| Monday | `educational_tip` | `cheatsheet` |
| Tuesday | `geo_insight` | `quote_card` |
| Wednesday | `hot_take_myth` | `comparison` |
| Thursday | `how_to_guide` | `cheatsheet` |
| Friday | `industry_trend` | `quote_card` |
| Saturday | `quick_hack` | `cheatsheet` |
| Sunday | `thought_leadership` | `quote_card` |

Template frequency per week: `cheatsheet` ×3, `quote_card` ×3, `comparison` ×1,
**`stat_card` ×0**. See section 7 — `stat_card` is defined, prompted for, and
unreachable.

---

## 4. Module 3 — `openai-gpt-3:CreateCompletion`

| Parameter | Value |
| --- | --- |
| `select` | `chat` |
| `model` | `gpt-4o-mini` |
| `temperature` | `0.85` |
| `top_p` | `1` |
| `max_tokens` | `3500` |
| `n_completions` | `1` |
| `response_format` | `json_object` |
| `parseJSONResponse` | `true` |
| `__IMTCONN__` | `[REDACTED]` (label `Pioneer OpenAI`, scoped `openai-gpt-3`) |

`max_tokens: 3500` is higher than the contractor scenarios' 2500 because this prompt
demands five platform bodies plus a Pinterest description in one response.
`parseJSONResponse: true` is what makes `3.result.<field>` dot-access work downstream;
without it every consumer would need a `parseJSON()` wrapper.

### COMPLETE system prompt (verbatim)

Note: `\n\n` appears as literal backslash-n text in the FORMATTING rule, and `\\n\\n`
as literal double-backslash text inside the JSON schema block. Both are reproduced
exactly as the model receives them.

```text
You are the Head of Content for Peralytics — a cutting-edge AI SEO agency that gives EQUAL WEIGHT to GEO, AI SEO, and Traditional SEO.

Generate platform-specific content for FB, LinkedIn, Instagram, Twitter (X), and Pinterest.

## CORE RULES:
1. NEVER include news URLs
2. First-person as Peralytics ('We've seen', 'Our team')
3. End each post with CTA mentioning aiseocompany.com
4. Specific tactics, frameworks, numbers
5. Rotate across GEO, AI SEO, Traditional SEO
6. NO double quotes inside text values

## TONE (CRITICAL):
- NO EMOJIS in post text
- No fancy symbols
- Plain numbered lists (1. 2. 3.)
- Clean professional text

## FORMATTING (CRITICAL):
- \n\n between EVERY paragraph and EVERY list item
- Each paragraph: 1-3 short sentences max

CONTENT TYPE: {{2.content_type}}
IMAGE TEMPLATE: {{2.image_template}}

IMAGE DATA REQUIREMENTS (BE CONCISE - short crisp text for posters):
- stat_card: stat (max 4 chars), stat_label (max 12 words), overline (1 word)
- cheatsheet: title (max 5 words), highlight_word, tips (5 items max 4 words), tip_subtitles (5 items max 6 words), framework_name
- comparison: title (max 4 words), highlight_word, old_label, new_label, old_items (4 max 3 words), new_items (4 max 3 words)
- quote_card: quote_part1 (max 5 words), quote_part2 (max 5 words), subquote (max 15 words)

OUTPUT (JSON only):
{
  "topic": "3-5 words",
  "service_focus": "GEO | AI SEO | Traditional SEO | Hybrid",
  "hook": "opening hook",
  "facebook_post": "180-280 words. NO EMOJIS. \\n\\n between paragraphs. End with: Want to rank in AI search and Google together? Book a free strategy call at https://aiseocompany.com/",
  "linkedin_post": "250-350 words. NO EMOJIS. \\n\\n between paragraphs. End with: At Peralytics, we help brands dominate AI search, LLMs, and Google. Ready to future-proof your SEO? Visit https://aiseocompany.com/",
  "instagram_post": "120-180 words for Instagram. NO EMOJIS. Short snappy paragraphs with \\n\\n breaks. End with: Link in bio for free strategy call - aiseocompany.com. Then 15-20 relevant SEO hashtags like #AISEO #GEO #SEOTips #DigitalMarketing #ContentMarketing #SearchEngineOptimization #AIMarketing #ContentStrategy #OnlineMarketing #GrowthHacking #SEOExpert #DigitalStrategy #ContentCreator #MarketingTips #BusinessGrowth",
  "twitter_post": "230-270 characters MAX (HARD LIMIT). NO EMOJIS. Punchy value-packed tweet. End with aiseocompany.com and 2-3 hashtags like #AISEO #GEO #SEO",
  "pinterest_title": "Pinterest pin title 40-100 chars. Examples: '5 AI SEO Hacks That Actually Work in 2026' or 'Stop Doing SEO This Way - Try This Instead'",
  "pinterest_description": "150-300 words. Keyword-rich Pinterest description. Multiple short paragraphs with \\n\\n breaks. SEO keywords placed naturally. End with: Visit aiseocompany.com for free strategy call. Then 10-15 hashtags like #AISEO #SEOTips #DigitalMarketing #ContentStrategy #SEOExpert #AIMarketing #GoogleSEO #SearchEngineOptimization",
  "image_data": {
    "stat": "e.g. 3.4× or 218%",
    "stat_label": "max 12 words",
    "overline": "RESULT | GROWTH | IMPACT",
    "title": "headline starting words",
    "highlight_word": "1-2 words for gradient emphasis",
    "tips": ["5 tips, max 4 words each"],
    "tip_subtitles": ["5 subtitles, max 6 words each"],
    "framework_name": "PLAYBOOK | FRAMEWORK | GUIDE",
    "old_label": "1 word",
    "new_label": "AI SEO style",
    "old_items": ["4 items, max 3 words each"],
    "new_items": ["4 items, max 3 words each"],
    "quote_part1": "first half",
    "quote_part2": "second half for gradient",
    "subquote": "context, max 15 words",
    "category_label": "INSIGHT | TIP | PLAYBOOK"
  }
}

Fill image_data fields matching today's template. Other fields can be empty strings.
```

### COMPLETE user prompt (verbatim)

```text
Today is {{2.day_of_week}}. Content type: {{2.content_type}}. Image template: {{2.image_template}}.

Write fresh content for ALL 5 platforms (Facebook, LinkedIn, Instagram, Twitter, Pinterest). Each platform optimized.

CRITICAL - NO DUPLICATES: Below are topics we have ALREADY posted before. You MUST choose a completely different topic, hook, and angle. Do NOT reuse anything from this list:

[ALREADY POSTED]
{{13.posted_topics}}
[END LIST]

If the list above is empty, create a fresh original topic.

For image_data: KEEP TEXT VERY SHORT. The image is a poster.

Generate JSON now.
```

The `{{13.posted_topics}}` interpolation is the entire duplicate-prevention surface.
See section 11.

---

## 5. Exact JSON output schema demanded by the prompt

Enforced only as `response_format: json_object` (valid JSON) plus prose constraints.
There is no JSON Schema, no function/tool call, and no post-validation module — nothing
in the scenario checks any of the limits below.

### Top-level fields

| Field | Type | Stated constraint | Consumed by |
| --- | --- | --- | --- |
| `topic` | string | 3-5 words | LinkedIn `title` (module 9), history write (module 14) |
| `service_focus` | string | enum-ish: `GEO` \| `AI SEO` \| `Traditional SEO` \| `Hybrid` | **nothing — never referenced** |
| `hook` | string | "opening hook" | **nothing — never referenced** |
| `facebook_post` | string | 180-280 words, no emojis, `\\n\\n` between paragraphs, fixed closing CTA | module 8 `message` |
| `linkedin_post` | string | 250-350 words, no emojis, `\\n\\n` between paragraphs, fixed closing CTA | module 9 `content` |
| `instagram_post` | string | 120-180 words, no emojis, `\\n\\n` breaks, closing CTA, then 15-20 hashtags | module 10 `caption` |
| `twitter_post` | string | 230-270 characters MAX (HARD LIMIT), no emojis, 2-3 hashtags | **nothing — no Twitter module exists** |
| `pinterest_title` | string | 40-100 chars | module 12 `title` |
| `pinterest_description` | string | 150-300 words, keyword-rich, `\\n\\n` breaks, closing CTA, then 10-15 hashtags | module 12 `description` |
| `image_data` | object | 16 keys, see below | modules 4 / 6 (template interpolation) |

Word/character counts are advisory prose. `twitter_post` carries the only "HARD LIMIT"
label in the schema and is also the only field with no consumer.

### `image_data` sub-fields, with the per-template constraint block

The system prompt states requirements twice: once in the `IMAGE DATA REQUIREMENTS`
block (per template) and once inline in the schema. Both are captured here.

| Key | Schema hint | Requirements-block constraint | Template that reads it |
| --- | --- | --- | --- |
| `stat` | `e.g. 3.4× or 218%` | max 4 chars | `tpl_stat` (unreachable) |
| `stat_label` | max 12 words | max 12 words | `tpl_stat` (unreachable) |
| `overline` | `RESULT \| GROWTH \| IMPACT` | 1 word | `tpl_stat` (unreachable) |
| `title` | headline starting words | cheatsheet max 5 words; comparison max 4 words | `tpl_cheat`, `tpl_compare` |
| `highlight_word` | 1-2 words for gradient emphasis | (unbounded) | `tpl_cheat`, `tpl_compare` |
| `tips` | array, 5 items max 4 words each | 5 items max 4 words | `tpl_cheat` (indices 1-5) |
| `tip_subtitles` | array, 5 items max 6 words each | 5 items max 6 words | `tpl_cheat` (indices 1-5) |
| `framework_name` | `PLAYBOOK \| FRAMEWORK \| GUIDE` | required for cheatsheet | `tpl_cheat` pill |
| `old_label` | 1 word | comparison | `tpl_compare` |
| `new_label` | `AI SEO style` | comparison | `tpl_compare` |
| `old_items` | array, 4 items max 3 words each | 4 max 3 words | `tpl_compare` (indices 1-4) |
| `new_items` | array, 4 items max 3 words each | 4 max 3 words | `tpl_compare` (indices 1-4) |
| `quote_part1` | first half | max 5 words | `tpl_quote` |
| `quote_part2` | second half for gradient | max 5 words | `tpl_quote` |
| `subquote` | context, max 15 words | max 15 words | `tpl_quote` |
| `category_label` | `INSIGHT \| TIP \| PLAYBOOK` | not in requirements block | `tpl_stat`, `tpl_cheat`, `tpl_quote` |

The model is told to "Fill image_data fields matching today's template. Other fields can
be empty strings." — so on any given day roughly a quarter of `image_data` is populated
and the rest is empty. Every template read is wrapped in `ifempty()` for that reason
(section 6).

---

## 6. Module 4 — `util:SetVariables` (templates + CSS)

`scope: "roundtrip"`. Five variables: four HTML card templates and one shared
stylesheet. All are single-line strings; reproduced verbatim below.

Conventions used throughout:
- HTML attributes use **single quotes**, so the JSON-embedded double quotes belong only
  to `ifempty()` fallbacks.
- Array access is `get(3.result.image_data.tips; N)` with **1-based** indices.
- Every dynamic read is `ifempty(<expr>; <fallback>)`. Label fields get a real text
  fallback; **content fields fall back to the empty string `""`**, so a missing model
  field renders as a blank region rather than a default. That is a real fragility to fix
  on migration.

### `tpl_stat` (verbatim — defined but never selected, see section 7)

```html
<div class='card stat-card'><div class='grid-overlay'></div><div class='orb stat-orb-1'></div><div class='orb stat-orb-2'></div><div class='header'><div class='logo-group'><div class='logo-box grad-logo'>P</div><span class='brand grad-text'>PERALYTICS</span></div><div class='pill glass-pill'><span class='live-dot'></span>{{ifempty(3.result.image_data.category_label; "LIVE INSIGHT")}}</div></div><div class='stat-body'><div class='overline-row'><div class='accent-line'></div><span class='overline-tag purple-light'>{{ifempty(3.result.image_data.overline; "CLIENT RESULT")}}</span></div><div class='mega-stat'>{{ifempty(3.result.image_data.stat; "")}}</div><div class='stat-desc'>{{ifempty(3.result.image_data.stat_label; "")}}</div><div class='trend-row'><div class='bar-chart'><div class='bar b1'></div><div class='bar b2'></div><div class='bar b3'></div><div class='bar b4'></div></div><span class='trend-text'>↑ trending up</span></div></div><div class='card-footer dark-footer'><div class='status-group'><div class='status-dot'></div><span class='url-dim'>aiseocompany.com</span></div><span class='cta-purple'>SEE FULL CASE →</span></div></div>
```

### `tpl_cheat` (verbatim — Mon / Thu / Sat)

```html
<div class='card cheat-card'><div class='cheat-orb-1'></div><div class='cheat-orb-2'></div><div class='header light-header'><div class='logo-group'><div class='logo-box grad-logo shadow'>P</div><span class='brand dark'>PERALYTICS</span></div><div class='pill gradient-pill'>{{ifempty(3.result.image_data.framework_name; "PLAYBOOK")}}</div></div><div class='title-block'><div class='overline-row'><div class='accent-line short'></div><span class='overline-tag purple'>{{ifempty(3.result.image_data.category_label; "AI SEO FRAMEWORK")}}</span></div><h1 class='cheat-title'>{{ifempty(3.result.image_data.title; "")}} <span class='gradient-word'>{{ifempty(3.result.image_data.highlight_word; "")}}</span></h1></div><div class='tip-list'><div class='tip-card'><div class='tip-num grad-num'>01</div><div class='tip-content'><span class='tip-main'>{{ifempty(get(3.result.image_data.tips; 1); "")}}</span><span class='tip-sub'>{{ifempty(get(3.result.image_data.tip_subtitles; 1); "")}}</span></div></div><div class='tip-card'><div class='tip-num grad-num'>02</div><div class='tip-content'><span class='tip-main'>{{ifempty(get(3.result.image_data.tips; 2); "")}}</span><span class='tip-sub'>{{ifempty(get(3.result.image_data.tip_subtitles; 2); "")}}</span></div></div><div class='tip-card'><div class='tip-num grad-num'>03</div><div class='tip-content'><span class='tip-main'>{{ifempty(get(3.result.image_data.tips; 3); "")}}</span><span class='tip-sub'>{{ifempty(get(3.result.image_data.tip_subtitles; 3); "")}}</span></div></div><div class='tip-card'><div class='tip-num grad-num'>04</div><div class='tip-content'><span class='tip-main'>{{ifempty(get(3.result.image_data.tips; 4); "")}}</span><span class='tip-sub'>{{ifempty(get(3.result.image_data.tip_subtitles; 4); "")}}</span></div></div><div class='tip-card'><div class='tip-num grad-num'>05</div><div class='tip-content'><span class='tip-main'>{{ifempty(get(3.result.image_data.tips; 5); "")}}</span><span class='tip-sub'>{{ifempty(get(3.result.image_data.tip_subtitles; 5); "")}}</span></div></div></div><div class='card-footer light-footer'><div class='dot-group'><div class='dot-i'></div><div class='dot-p'></div><div class='dot-l'></div><span class='footer-label'>Save this playbook</span></div><span class='gradient-url'>aiseocompany.com →</span></div></div>
```

### `tpl_compare` (verbatim — Wed)

```html
<div class='card cheat-card'><div class='cheat-orb-1'></div><div class='vs-badge'>VS</div><div class='header light-header'><div class='logo-group'><div class='logo-box grad-logo shadow'>P</div><span class='brand dark'>PERALYTICS</span></div><div class='pill amber-pill'>THE SHIFT</div></div><div class='title-block'><div class='overline-row'><div class='accent-line short'></div><span class='overline-tag purple'>EVOLUTION</span></div><h1 class='cheat-title'>{{ifempty(3.result.image_data.title; "Traditional SEO")}} → <span class='gradient-word'>{{ifempty(3.result.image_data.highlight_word; "AI SEO")}}</span></h1></div><div class='compare-grid'><div class='col-old-premium'><div class='col-head'><div class='x-badge-premium'>✕</div><span class='col-tag gray-tag'>{{ifempty(3.result.image_data.old_label; "OLD")}}</span></div><div class='comp-item old-item'>{{ifempty(get(3.result.image_data.old_items; 1); "")}}</div><div class='comp-item old-item'>{{ifempty(get(3.result.image_data.old_items; 2); "")}}</div><div class='comp-item old-item'>{{ifempty(get(3.result.image_data.old_items; 3); "")}}</div><div class='comp-item old-item last'>{{ifempty(get(3.result.image_data.old_items; 4); "")}}</div></div><div class='col-new-premium'><div class='new-badge-premium'>★ NEW WAY</div><div class='col-head'><div class='check-badge-premium'>✓</div><span class='col-tag purple-tag'>{{ifempty(3.result.image_data.new_label; "AI SEO")}}</span></div><div class='comp-item new-item-premium'>{{ifempty(get(3.result.image_data.new_items; 1); "")}}</div><div class='comp-item new-item-premium'>{{ifempty(get(3.result.image_data.new_items; 2); "")}}</div><div class='comp-item new-item-premium'>{{ifempty(get(3.result.image_data.new_items; 3); "")}}</div><div class='comp-item new-item-premium last'>{{ifempty(get(3.result.image_data.new_items; 4); "")}}</div></div></div><div class='card-footer light-footer'><span class='footer-label'>The future is here →</span><span class='gradient-url'>aiseocompany.com</span></div></div>
```

Note `tpl_compare` reuses the `cheat-card` body class, so it inherits the light theme,
`gap: 36px` and `justify-content: flex-start` from `.cheat-card`.

### `tpl_quote` (verbatim — Tue / Fri / Sun)

```html
<div class='card quote-card'><div class='grid-overlay'></div><div class='quote-deco-big'>&ldquo;</div><div class='quote-glow'></div><div class='quote-radial'></div><div class='header'><div class='logo-group'><div class='logo-box white-box'>P</div><span class='brand'>PERALYTICS</span></div><div class='pill glass-pill'>✦ {{ifempty(3.result.image_data.category_label; "INSIGHT")}}</div></div><div class='quote-body'><div class='overline-row'><div class='accent-bar-quote'></div><span class='overline-tag light-tag'>PERALYTICS INSIGHT</span></div><div class='quote-text'>{{ifempty(3.result.image_data.quote_part1; "")}} <span class='gradient-quote-word'>{{ifempty(3.result.image_data.quote_part2; "")}}</span></div><div class='quote-sub'>{{ifempty(3.result.image_data.subquote; "")}}</div></div><div class='card-footer quote-footer'><div class='author-block'><div class='author-avatar'>P</div><div class='author-info'><div class='author-name'>Peralytics Team</div><div class='author-role'>AI SEO Strategy</div></div></div><span class='url-light'>aiseocompany.com</span></div></div>
```

### `shared_css` (verbatim, single stylesheet for all four templates)

```css
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',-apple-system,sans-serif}body{margin:0;padding:0}.card{width:1080px;height:1080px;padding:80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.stat-card{background:radial-gradient(ellipse at top right,rgba(139,92,246,0.4) 0%,transparent 50%),radial-gradient(ellipse at bottom left,rgba(99,102,241,0.3) 0%,transparent 50%),linear-gradient(180deg,#0A0118 0%,#0F0A24 100%);color:white}.cheat-card{background:linear-gradient(135deg,#FAFAFA 0%,#F4F4FF 100%);color:#0A0A0F;gap:36px;justify-content:flex-start}.quote-card{background:linear-gradient(135deg,#1E1B4B 0%,#312E81 30%,#5B21B6 70%,#7C3AED 100%);color:white}.grid-overlay{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);background-size:80px 80px;pointer-events:none;z-index:1}.orb{position:absolute;border-radius:50%;pointer-events:none}.stat-orb-1{top:-200px;right:-200px;width:700px;height:700px;background:radial-gradient(circle,rgba(139,92,246,0.3) 0%,transparent 70%)}.stat-orb-2{bottom:-300px;left:-200px;width:650px;height:650px;background:radial-gradient(circle,rgba(99,102,241,0.2) 0%,transparent 70%)}.cheat-orb-1{position:absolute;top:-200px;right:-200px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,0.12) 0%,transparent 70%);pointer-events:none}.cheat-orb-2{position:absolute;bottom:-200px;left:-200px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,0.08) 0%,transparent 70%);pointer-events:none}.quote-glow{position:absolute;bottom:-400px;right:-400px;width:1000px;height:1000px;border-radius:50%;background:radial-gradient(circle,rgba(196,181,253,0.25) 0%,transparent 70%);pointer-events:none}.quote-radial{position:absolute;inset:0;background-image:radial-gradient(circle at 20% 30%,rgba(255,255,255,0.15) 0%,transparent 40%),radial-gradient(circle at 80% 70%,rgba(196,181,253,0.2) 0%,transparent 40%);pointer-events:none;z-index:1}.quote-deco-big{position:absolute;top:80px;right:80px;font-size:600px;line-height:0.6;opacity:0.08;font-family:Georgia,serif;font-weight:900;color:white;pointer-events:none;z-index:1}.header{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:3}.light-header{padding-bottom:24px;border-bottom:1px solid rgba(99,102,241,0.18)}.logo-group{display:flex;align-items:center;gap:14px}.logo-box{width:64px;height:64px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:34px}.grad-logo{background:linear-gradient(135deg,#8B5CF6 0%,#6366F1 50%,#4F46E5 100%);color:white;box-shadow:0 0 40px rgba(139,92,246,0.5)}.shadow{box-shadow:0 8px 24px rgba(99,102,241,0.35)}.white-box{background:white;color:#6366F1;box-shadow:0 0 40px rgba(255,255,255,0.4)}.brand{font-size:24px;font-weight:700;letter-spacing:6px}.grad-text{background:linear-gradient(90deg,#fff,#C7D2FE);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.brand.dark{color:#0A0A0F}.pill{padding:10px 24px;border-radius:100px;font-size:18px;font-weight:600;letter-spacing:2px;display:flex;align-items:center;gap:8px}.glass-pill{background:rgba(139,92,246,0.18);border:1px solid rgba(139,92,246,0.4);color:#C4B5FD;backdrop-filter:blur(10px)}.gradient-pill{background:linear-gradient(135deg,#EEF2FF,#E0E7FF);border:1px solid rgba(99,102,241,0.25);color:#4F46E5;font-weight:700}.amber-pill{background:linear-gradient(135deg,#FEF3C7,#FDE68A);color:#92400E;font-weight:700}.live-dot{width:10px;height:10px;border-radius:50%;background:#10B981;box-shadow:0 0 12px #10B981;display:inline-block}.stat-body{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;justify-content:center}.overline-row{display:flex;align-items:center;gap:14px;margin-bottom:20px}.accent-line{height:4px;width:60px;background:linear-gradient(90deg,#8B5CF6,transparent);border-radius:4px}.accent-line.short{width:32px;background:linear-gradient(90deg,#8B5CF6,#6366F1)}.overline-tag{font-size:18px;font-weight:700;letter-spacing:4px}.purple-light{color:#A78BFA}.purple{color:#6366F1}.light-tag{color:#C4B5FD}.mega-stat{font-size:340px;font-weight:900;background:linear-gradient(135deg,#ffffff 0%,#C4B5FD 40%,#8B5CF6 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:0.9;letter-spacing:-14px;margin-bottom:8px}.stat-desc{font-size:42px;color:#E0E7FF;line-height:1.35;font-weight:500;max-width:900px;opacity:0.92}.trend-row{display:flex;gap:14px;margin-top:32px;align-items:flex-end}.bar-chart{display:flex;gap:6px;align-items:flex-end}.bar{width:10px;border-radius:3px}.b1{height:24px;background:rgba(139,92,246,0.3)}.b2{height:36px;background:rgba(139,92,246,0.5)}.b3{height:48px;background:rgba(139,92,246,0.7)}.b4{height:64px;background:linear-gradient(180deg,#C4B5FD,#8B5CF6)}.trend-text{font-size:20px;color:#C4B5FD;font-weight:500}.title-block{position:relative;z-index:3}.cheat-title{font-size:68px;font-weight:800;color:#0A0A0F;line-height:1.08;letter-spacing:-2.5px;margin-top:12px}.gradient-word{background:linear-gradient(135deg,#6366F1,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.tip-list{display:flex;flex-direction:column;gap:14px;flex:1;position:relative;z-index:3}.tip-card{background:white;border:1px solid rgba(99,102,241,0.14);padding:20px 26px;border-radius:16px;display:flex;gap:22px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.04)}.tip-num{width:62px;height:62px;border-radius:14px;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:white}.grad-num{background:linear-gradient(135deg,#8B5CF6,#6366F1);box-shadow:0 6px 14px rgba(99,102,241,0.3)}.tip-content{display:flex;flex-direction:column;gap:4px;flex:1}.tip-main{font-size:26px;color:#0A0A0F;font-weight:700;line-height:1.3}.tip-sub{font-size:17px;color:#6B7280;font-weight:400}.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;flex:1;position:relative;z-index:2}.vs-badge{position:absolute;top:54%;left:50%;transform:translate(-50%,-50%);width:80px;height:80px;background:linear-gradient(135deg,#8B5CF6,#6366F1);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:28px;color:white;z-index:6;box-shadow:0 12px 28px rgba(99,102,241,0.4)}.col-old-premium{background:white;border:1px solid #E5E7EB;padding:32px;border-radius:20px;display:flex;flex-direction:column;gap:14px;position:relative}.col-new-premium{background:linear-gradient(135deg,#EEF2FF 0%,#F5F3FF 50%,#FAF5FF 100%);border:3px solid #6366F1;padding:32px;border-radius:20px;display:flex;flex-direction:column;gap:14px;position:relative;box-shadow:0 16px 40px rgba(99,102,241,0.18)}.new-badge-premium{position:absolute;top:-18px;right:24px;background:linear-gradient(135deg,#8B5CF6,#6366F1);color:white;font-size:16px;padding:8px 22px;border-radius:100px;font-weight:800;letter-spacing:2px;box-shadow:0 8px 16px rgba(99,102,241,0.35)}.col-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}.x-badge-premium{width:38px;height:38px;background:linear-gradient(135deg,#FEE2E2,#FECACA);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#DC2626;font-weight:800}.check-badge-premium{width:38px;height:38px;background:linear-gradient(135deg,#8B5CF6,#6366F1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:white;font-weight:800;box-shadow:0 4px 10px rgba(99,102,241,0.3)}.col-tag{font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:2.5px}.gray-tag{color:#9CA3AF}.purple-tag{color:#6366F1}.comp-item{font-size:26px;line-height:1.4;padding:10px 0;font-weight:500}.old-item{color:#6B7280;border-bottom:1px dashed #E5E7EB;text-decoration:line-through;text-decoration-color:#D1D5DB}.new-item-premium{color:#0A0A0F;font-weight:700;border-bottom:1px solid rgba(99,102,241,0.12)}.comp-item.last{border-bottom:none}.quote-body{position:relative;z-index:3}.accent-bar-quote{height:6px;width:50px;background:linear-gradient(90deg,white,#C4B5FD);border-radius:100px}.quote-text{font-size:88px;font-weight:800;line-height:1.1;letter-spacing:-3px;max-width:920px;margin-top:32px}.gradient-quote-word{background:linear-gradient(135deg,#C4B5FD,#FFFFFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.quote-sub{font-size:24px;opacity:0.78;margin-top:28px;font-weight:400;line-height:1.5;max-width:780px}.card-footer{display:flex;justify-content:space-between;align-items:center;padding-top:20px;position:relative;z-index:3}.dark-footer{border-top:1px solid rgba(255,255,255,0.1)}.light-footer{border-top:1px solid rgba(99,102,241,0.18)}.quote-footer{border-top:1px solid rgba(255,255,255,0.18);padding-top:24px}.status-group{display:flex;align-items:center;gap:12px}.status-dot{width:10px;height:10px;background:#10B981;border-radius:50%;box-shadow:0 0 10px #10B981}.url-dim{font-size:20px;color:#94A3B8;letter-spacing:1px;font-weight:500}.cta-purple{font-size:20px;color:#C4B5FD;font-weight:700;letter-spacing:1px}.dot-group{display:flex;align-items:center;gap:10px}.dot-i,.dot-p,.dot-l{width:8px;height:8px;border-radius:50%}.dot-i{background:#6366F1}.dot-p{background:#8B5CF6}.dot-l{background:#C084FC}.footer-label{font-size:20px;color:#6B7280;font-weight:500;margin-left:6px}.gradient-url{font-size:22px;background:linear-gradient(135deg,#6366F1,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800}.author-block{display:flex;align-items:center;gap:14px}.author-avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#C4B5FD,#818CF8);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:white}.author-name{font-size:20px;opacity:0.95;font-weight:700}.author-role{font-size:16px;opacity:0.65;font-weight:400}.url-light{font-size:20px;opacity:0.78;letter-spacing:1.5px;font-weight:500}
```

---

## 7. Module 5 — `util:SetVariable2` (template selection)

```json
{
  "id": 5,
  "module": "util:SetVariable2",
  "mapper": {
    "name": "final_html",
    "scope": "roundtrip",
    "value": "{{switch(2.image_template; \"stat_card\"; 4.tpl_stat; \"cheatsheet\"; 4.tpl_cheat; \"comparison\"; 4.tpl_compare; \"quote_card\"; 4.tpl_quote)}}"
  }
}
```

Selector expression verbatim:

```
{{switch(2.image_template; "stat_card"; 4.tpl_stat; "cheatsheet"; 4.tpl_cheat; "comparison"; 4.tpl_compare; "quote_card"; 4.tpl_quote)}}
```

**Dead branch.** The selector handles `stat_card`, but the module 2 rhythm switch never
emits `stat_card` on any of the seven days. Therefore `tpl_stat` — together with the
`.stat-card`, `.mega-stat`, `.stat-desc`, `.trend-row`, `.bar-chart`, `.stat-orb-*`,
`.b1`-`.b4`, `.url-dim`, `.cta-purple` CSS and the `stat` / `stat_label` / `overline`
prompt fields — is unreachable in production. The model is still instructed to
understand `stat_card` and still emits those fields. Migration should either wire
`stat_card` into the rhythm or drop the whole branch; keeping both costs tokens and
maintenance for no rendered output.

---

## 8. Module 6/7 — `html-css-to-image`

### Module 6 `html-css-to-image:Image` — render settings

| Parameter | Value |
| --- | --- |
| `html` | `{{5.final_html}}` |
| `css` | `{{4.shared_css}}` |
| `viewport_width` | `1080` |
| `viewport_height` | `1080` |
| `device_scale` | `2` |
| `google_fonts` | `Inter` |
| `__IMTCONN__` | `[REDACTED]` (label `Peralytics AI SEO Company([REDACTED])`, scoped `html-css-to-image`) |

Effective output raster is **2160 × 2160** (1080 CSS px at `device_scale: 2`). The card
root also hard-codes `width:1080px;height:1080px` in CSS, so the viewport and the
element agree; nothing is cropped or letterboxed.

`google_fonts: "Inter"` loads only Inter. The CSS also references `Georgia, serif` for
`.quote-deco-big` (the oversized decorative opening quotation mark) and falls back to
`-apple-system, sans-serif`. Georgia is **not** requested from Google Fonts and is not
guaranteed on the renderer, so that glyph depends on the hcti host's font stack. It is
decorative only (opacity 0.08).

### Module 7 `html-css-to-image:GetImage`

| Parameter | Value |
| --- | --- |
| `image_id` | `{{6.id}}` |
| `format` | `png` |
| `__IMTCONN__` | `[REDACTED]` (same connection as module 6) |

Produces `7.image` (binary) and `7.fileName`.

**Format split.** Facebook and LinkedIn consume the binary `7.image` (PNG). Instagram
and Pinterest instead rebuild a URL by hand as
`https://hcti.io/v1/image/{{6.id}}.jpg` — **`.jpg`, not `.png`** — so those two
platforms receive a JPEG re-encode of the same render id while the other two receive
PNG. Two different codecs for the same daily creative. Worth normalising on migration.

### Where colour hexes, fonts, logo and business constants are supplied

Everything is **hard-coded in `shared_css` and the four HTML templates**. There is no
brand-kit input, no colour variable, no logo asset and no per-run theming:

- **Logo**: a typographic `P` glyph inside `.logo-box` (64×64, `border-radius:16px`).
  Three variants: `.grad-logo` (violet gradient fill, white letter, violet glow),
  `.grad-logo.shadow` (light templates), `.white-box` (white fill, `#6366F1` letter).
  Plus a 48×48 `.author-avatar` `P` on the quote card. **No image file is referenced
  anywhere** — no `<img>`, no data URI, no remote asset.
- **Wordmark**: literal text `PERALYTICS`, `font-size:24px`, `font-weight:700`,
  `letter-spacing:6px`; either `.grad-text` (white → `#C7D2FE` gradient) or `.brand.dark`
  (`#0A0A0F`).
- **Fonts**: `Inter` via `google_fonts`, weights used 400/500/700/800/900;
  `Georgia, serif` for the decorative quote mark only.
- **Colours**: a fixed indigo/violet system, listed in full in section 9.

---

## 9. Business constants (complete inventory)

Unlike the contractor scenarios there is **no `BUSINESS:` block in the prompt** — no
phone number, no street address, no contact email, no service-area list. The only
identity constants are the brand name, the domain and the visual system.

### Identity and destination

| Constant | Value | Where |
| --- | --- | --- |
| Brand name | `Peralytics` | system prompt, `.author-name` (`Peralytics Team`) |
| Wordmark | `PERALYTICS` | all four templates |
| Logo mark | letter `P` (typographic, no asset) | all four templates |
| Website | `aiseocompany.com` | all four template footers |
| Website (absolute) | `https://aiseocompany.com/` | FB + LinkedIn CTA strings, Pinterest `link` |
| Positioning line | `a cutting-edge AI SEO agency that gives EQUAL WEIGHT to GEO, AI SEO, and Traditional SEO` | system prompt |
| Persona | `Head of Content for Peralytics` | system prompt |
| Author byline | `Peralytics Team` / `AI SEO Strategy` | `tpl_quote` |
| Service taxonomy | `GEO` \| `AI SEO` \| `Traditional SEO` \| `Hybrid` | `service_focus` enum |

### Fixed CTA strings (verbatim, mandated by the prompt)

| Platform | Required closing line |
| --- | --- |
| Facebook | `Want to rank in AI search and Google together? Book a free strategy call at https://aiseocompany.com/` |
| LinkedIn | `At Peralytics, we help brands dominate AI search, LLMs, and Google. Ready to future-proof your SEO? Visit https://aiseocompany.com/` |
| Instagram | `Link in bio for free strategy call - aiseocompany.com` |
| Pinterest | `Visit aiseocompany.com for free strategy call` |
| Twitter | `End with aiseocompany.com and 2-3 hashtags` (never published) |

### Fixed hashtag seed lists (verbatim)

- **Instagram** (15-20 requested): `#AISEO #GEO #SEOTips #DigitalMarketing #ContentMarketing #SearchEngineOptimization #AIMarketing #ContentStrategy #OnlineMarketing #GrowthHacking #SEOExpert #DigitalStrategy #ContentCreator #MarketingTips #BusinessGrowth`
- **Pinterest** (10-15 requested): `#AISEO #SEOTips #DigitalMarketing #ContentStrategy #SEOExpert #AIMarketing #GoogleSEO #SearchEngineOptimization`
- **Twitter** (2-3 requested): `#AISEO #GEO #SEO`

### Fixed UI strings baked into templates

`LIVE INSIGHT`, `CLIENT RESULT`, `↑ trending up`, `SEE FULL CASE →`, `PLAYBOOK`,
`AI SEO FRAMEWORK`, `Save this playbook`, `aiseocompany.com →`, `THE SHIFT`,
`EVOLUTION`, `VS`, `★ NEW WAY`, `✕`, `✓`, `OLD`, `AI SEO`, `Traditional SEO`,
`The future is here →`, `✦`, `INSIGHT`, `PERALYTICS INSIGHT`, `01`-`05`.

### Alt text / post metadata constants

| Field | Value | Module |
| --- | --- | --- |
| LinkedIn `altText` | `Peralytics AI SEO insights` | 9 |
| Pinterest `alt_text` | `Peralytics AI SEO insights and tips` | 12 |
| Pinterest `link` | `https://aiseocompany.com/` | 12 |
| LinkedIn `visibility` | `PUBLIC` | 9 |
| LinkedIn `feedDistribution` | `MAIN_FEED` | 9 |
| LinkedIn `isReshareDisabledByAuthor` | `false` | 9 |

### Colour system (every hex in `shared_css`)

**Core brand violets/indigos:** `#8B5CF6` (primary violet), `#6366F1` (primary indigo),
`#4F46E5`, `#7C3AED`, `#5B21B6`, `#A78BFA`, `#C4B5FD`, `#C084FC`, `#818CF8`, `#C7D2FE`.

**Dark surfaces (stat card):** `#0A0118`, `#0F0A24`.
**Quote card gradient:** `#1E1B4B` → `#312E81` (30%) → `#5B21B6` (70%) → `#7C3AED` (100%).
**Light surfaces (cheat/compare):** `#FAFAFA` → `#F4F4FF`; panels `#EEF2FF`, `#E0E7FF`,
`#F5F3FF`, `#FAF5FF`, plus `white`.
**Ink:** `#0A0A0F` (primary), `#6B7280`, `#9CA3AF`, `#94A3B8`.
**Hairlines:** `#E5E7EB`, `#D1D5DB`, `rgba(99,102,241,0.12/0.14/0.18/0.25)`,
`rgba(255,255,255,0.1/0.18)`.
**Accent — success/live:** `#10B981` (live dot + status dot, with matching glow).
**Accent — amber pill:** `#FEF3C7` → `#FDE68A` background, `#92400E` text.
**Accent — negative badge:** `#FEE2E2` → `#FECACA` background, `#DC2626` glyph.

### Typography scale (fixed)

`.mega-stat` 340px/900 (unreachable) · `.quote-text` 88px/800 · `.cheat-title` 68px/800 ·
`.stat-desc` 42px/500 (unreachable) · `.tip-main` 26px/700 · `.comp-item` 26px/500 ·
`.brand` 24px/700 · `.quote-sub` 24px/400 · `.gradient-url` 22px/800 ·
`.tip-sub` 17px/400 · `.pill` 18px/600 · `.overline-tag` 18px/700 ·
`.col-tag` 18px/800 · `.new-badge-premium` 16px/800 · `.author-role` 16px/400.

Canvas geometry: `1080×1080`, `padding:80px`, flex column, `overflow:hidden`.

---

## 10. Filters, routers, error handling

**There are none.** Verified against every module in the flow:

- No module carries a `filter` key. Nothing is conditional; all 13 modules run on every
  execution.
- No routers (`builtin:BasicRouter`) exist. `designer.orphans` is empty.
- No module carries an `onerror` directive, so there are no error-handler routes,
  no `resume`, no `rollback`, no `break`, no `ignore`.
- Only scenario-level defaults apply: `maxErrors: 3`, `autoCommit: true`,
  `sequential: false`, `dataloss: false`, `dlq: false`.

Consequences to carry into migration:

1. **All-or-nothing chain.** A failure at any publish module aborts the remainder. If
   Facebook (module 8) fails, LinkedIn, Instagram, Pinterest **and the history write**
   (module 14) never run.
2. **Partial publication is unrecoverable.** If Instagram (module 11 in run order)
   fails after Facebook and LinkedIn succeeded, the post is live on two networks, absent
   on two, and the topic is **not** recorded in history — so the next run may regenerate
   the same topic and re-post it to Facebook and LinkedIn.
3. **No model-output validation.** Nothing checks word counts, the 230-270 char Twitter
   limit, hashtag counts, array lengths, emoji absence, or that `image_data` matches the
   day's template. A short or malformed `image_data` renders a half-empty poster and
   still publishes.
4. **No image verification.** Nothing confirms the hcti render succeeded or that the
   `.jpg` URL variant resolves before Instagram and Pinterest are handed it.
5. **`twitter_post` is generated and discarded** on every run (module id 11 gap). Tokens
   are spent daily on an output with no consumer.

---

## 11. THE HISTORY MECHANISM (data store) — full detail

This is the only scenario in the set with a Make data store. Duplicate prevention is
implemented as a **read-modify-write of one text blob**, with enforcement delegated
entirely to the language model.

### 11.1 Store and structure

| Field | Value |
| --- | --- |
| Data store id | `[REDACTED]` |
| Data store name | `Peralytics Post History` |
| Team id | `2388544` |
| Data structure id | `[REDACTED]` |
| Data structure name | `Peralytics Post Memory Structure` |
| Records (at capture) | `1` |
| Size / max size | `365` bytes / `1048576` bytes (1 MB) |

Data structure spec — **a single field**:

```json
[
  { "name": "posted_topics", "type": "text", "label": "Posted Topics" }
]
```

There is no topic array, no date field, no platform field, no id, no embedding. One
text column.

### 11.2 Read — module 13 `datastore:GetRecord`

```json
{
  "id": 13,
  "module": "datastore:GetRecord",
  "version": 1,
  "mapper": { "key": "memory", "returnWrapped": false },
  "parameters": { "datastore": "[REDACTED]" },
  "metadata": { "designer": { "x": 450, "y": 0 } }
}
```

- **Key looked up: the literal string `memory`.** It is a hard-coded constant, not an
  expression. There is no date, no weekday, no content-type and no platform in the key.
  The store therefore holds exactly **one singleton row** that accumulates forever; the
  live store confirms `records: 1`.
- `returnWrapped: false` puts the record's fields directly on the module output, which is
  what allows the bare `13.posted_topics` reference downstream.
- Placed at `x: 450`, i.e. **after** the rhythm variables and **before** the OpenAI call.
  It exists solely to feed the prompt.
- If the key is missing (first ever run, or the record is deleted), `13.posted_topics`
  resolves empty. There is no error handler on this module; the design leans on
  `ifempty()` at the write step and on the prompt line "If the list above is empty,
  create a fresh original topic."

### 11.3 Inject — inside the module 3 user prompt

The retrieved blob is interpolated straight into the user message as a delimited block:

```text
CRITICAL - NO DUPLICATES: Below are topics we have ALREADY posted before. You MUST choose a completely different topic, hook, and angle. Do NOT reuse anything from this list:

[ALREADY POSTED]
{{13.posted_topics}}
[END LIST]

If the list above is empty, create a fresh original topic.
```

Properties of this injection:

- It lands in the **user** message, not the system message, so it is subject to normal
  recency/attention behaviour rather than being pinned as a rule.
- The whole accumulated blob is injected **raw and unbounded** — no truncation, no
  windowing to the last N topics, no tokenisation. Prompt size grows linearly with the
  age of the automation.
- The model is asked to avoid the topic **and** the hook **and** the angle, but it only
  ever sees the topic string plus a weekday. It has no record of the hooks or angles
  actually used, so two of the three constraints are unverifiable by the model.
- The instruction is advisory. Nothing measures similarity or rejects a repeat.

### 11.4 Write-back — module 14 `datastore:AddRecord`

```json
{
  "id": 14,
  "module": "datastore:AddRecord",
  "version": 1,
  "mapper": {
    "key": "memory",
    "data": {
      "posted_topics": "{{ifempty(13.posted_topics; \"\") + \" || \" + (3.result.topic) + \" (\" + (2.day_of_week) + \")\"}}"
    },
    "overwrite": true
  },
  "parameters": { "datastore": "[REDACTED]" },
  "metadata": { "designer": { "x": 3300, "y": 0 } }
}
```

Append expression verbatim:

```
{{ifempty(13.posted_topics; "") + " || " + (3.result.topic) + " (" + (2.day_of_week) + ")"}}
```

- **Same literal key `memory`**, with `overwrite: true`, so `AddRecord` behaves as an
  **upsert** on the singleton row: the old blob is read from module 13, concatenated
  with the new entry, and written back whole.
- Appended entry format: `" || " + <topic> + " (" + <weekday name> + ")"`.
- The `" || "` separator is **prepended** to every entry, including the first, so the
  stored blob always begins with a leading `" || "`. The live record confirms this.
- `ifempty(13.posted_topics; "")` guards the very first run, where the record does not
  yet exist.
- It is the **last module in the chain** (`x: 3300`), after all four publish modules.
  That ordering is deliberate-looking but has the failure mode described in section 10:
  any publish error means the topic is never recorded.

### 11.5 Live state at capture (evidence)

```json
{
  "key": "memory",
  "data": {
    "posted_topics": " || Local SEO Myths (Wednesday) || Maximize Local Search Results (Thursday) || Geo-Targeting Strategies (Tuesday) || Traditional SEO vs AI SEO (Wednesday) || Local Search Optimization Tips (Thursday) || The Future of Search (Friday) || Enhancing Local Citations (Saturday) || Navigating SEO Shifts (Sunday)"
  }
}
```

Eight entries, 365 bytes, leading `" || "` exactly as predicted by the expression.

**This live data demonstrates the mechanism's central weakness.** The model is told to
avoid repeating a topic, and it does avoid repeating the exact *string* — but the stored
history is semantically clustered:

- `Local SEO Myths` / `Local Search Optimization Tips` / `Maximize Local Search Results`
  / `Enhancing Local Citations` — four local-SEO topics.
- `Traditional SEO vs AI SEO` / `The Future of Search` / `Navigating SEO Shifts` — three
  restatements of the same "SEO is changing" thesis.

String-level novelty was achieved; topical novelty was not. Eight posts collapse to
roughly three distinct ideas.

### 11.6 Design assessment for migration

What the mechanism gets right:

- Read-before-generate, write-after-publish is the correct shape.
- Idempotent-ish upsert on a fixed key keeps the store trivially small.
- The empty-history case is explicitly handled in both the expression and the prompt.

What must not be carried over as-is:

1. **Advisory-only enforcement.** Duplicate prevention is a sentence in a prompt. There
   is no similarity check, no rejection, no regeneration loop. Replace with a real
   comparison (normalised topic match plus embedding/semantic distance) and a bounded
   retry when the candidate is too close to history.
2. **Unbounded growth.** The blob is append-only with no cap, no pruning and no rotation
   against the 1 MB store limit. At ~45 bytes per entry the ceiling is roughly 23,000
   posts, but the *prompt* becomes unusable long before the *store* does. Use a rolling
   window (e.g. last 60-90 days) plus a durable archive.
3. **Lossy entry format.** `Topic (Weekday)` records no date, no year, no platform, no
   post id, no `service_focus`, no hook and no image template. The weekday repeats every
   seven days, so entry age is unknowable and nothing can be traced back to a published
   post. Store structured rows: `{ id, topic, hook, service_focus, content_type,
   image_template, published_at, per-platform post ids }`.
4. **Single global key.** One `memory` row for the whole account cannot scale to multiple
   brands, and it conflates the four platforms into one stream. Key by business/brand at
   minimum.
5. **Delimiter fragility.** `" || "` is unescaped; a model-generated topic containing
   `||` silently corrupts parsing for any future consumer. Use real rows.
6. **Write is gated on full publish success.** History should be recorded per successful
   platform, not all-or-nothing at the end of the chain.
7. **Topic-only memory cannot satisfy a topic+hook+angle instruction.** Either persist
   hooks and angles, or stop asking the model to avoid them.

---

## 12. Publishing modules

Four platforms. Two consume the PNG binary, two consume a hand-built hcti URL.

### Module 8 — `facebook-pages:UploadPhoto` (v6)

| Field | Value |
| --- | --- |
| `page_id` | `[REDACTED]` |
| `message` | `{{3.result.facebook_post}}` |
| `data` | `{{7.image}}` (PNG binary) |
| `fileName` | `{{7.fileName}}` |
| `__IMTCONN__` | `[REDACTED]` (label `Talha Javed`, scoped `facebook`) |

### Module 9 — `linkedin:CreateCompanyImagePost` (v2)

| Field | Value |
| --- | --- |
| `organization` | `urn:li:organization:[REDACTED]` |
| `title` | `{{3.result.topic}}` |
| `content` | `{{3.result.linkedin_post}}` |
| `method` | `upload` |
| `data` | `{{7.image}}` (PNG binary) |
| `fileName` | `{{7.fileName}}` |
| `altText` | `Peralytics AI SEO insights` |
| `visibility` | `PUBLIC` |
| `feedDistribution` | `MAIN_FEED` |
| `isReshareDisabledByAuthor` | `false` |
| `__IMTCONN__` | `[REDACTED]` (label `Muhammad Talha Javed`, scoped `linkedin2`) |

### Module 10 — `instagram-business:CreatePostPhoto` (v1)

| Field | Value |
| --- | --- |
| `accountId` | `[REDACTED]` |
| `caption` | `{{3.result.instagram_post}}` |
| `image_url` | `https://hcti.io/v1/image/{{6.id}}.jpg` |
| `__IMTCONN__` | `[REDACTED]` (label `Talha Javed (Muhammad Talha Javed)`, scoped `facebook` — **the same connection as module 8**) |

Instagram requires a publicly reachable URL rather than a binary, which is why the hcti
URL is reconstructed by string concatenation from `6.id` instead of reusing `7.image`.

### Module 12 — `pinterest:createPin` (v2)

| Field | Value |
| --- | --- |
| `board_id` | `[REDACTED]` |
| `title` | `{{3.result.pinterest_title}}` |
| `description` | `{{3.result.pinterest_description}}` |
| `link` | `https://aiseocompany.com/` |
| `alt_text` | `Peralytics AI SEO insights and tips` |
| `media_source.source_type` | `image_url` |
| `media_source.url` | `https://hcti.io/v1/image/{{6.id}}.jpg` |
| `__IMTCONN__` | `[REDACTED]` (label `Peralytics AI SEO Company`, scoped `pinterest2`) |

### Not published: Twitter / X

`twitter_post` is specified in the schema with the only hard limit in the prompt
(230-270 characters) and is consumed by nothing. Module id `11` is missing from the
flow and no Twitter app appears in `usedPackages`. Treat the field as dead output.

---

## 13. Migration notes

1. **Timezone must become explicit.** The 13:00 fire time resolves against an inherited,
   undeclared team timezone (inferred UTC+5). The rhythm switches key off
   `formatDate(now; "dddd")` in that same zone, so a timezone change silently reassigns
   both content type and template. Pin the zone in code.
2. **Rhythm is a pure function of weekday.** Two switch expressions, seven arms each,
   trivially portable to a lookup table. Preserve the exact pairings in section 3.
3. **`stat_card` is unreachable.** Decide deliberately: wire it into the rhythm or delete
   the template, its CSS block and its three prompt fields.
4. **Duplicate prevention needs real enforcement**, not a prompt sentence. See 11.6 for
   the full list; the semantic clustering in the live data (11.5) is the proof it is
   currently insufficient.
5. **Normalise the image format.** PNG to Facebook/LinkedIn, JPEG to Instagram/Pinterest
   for the same creative, from two different retrieval paths.
6. **Add per-platform isolation.** The linear chain makes any single API failure abort
   every downstream platform and the history write.
7. **Validate model output before rendering and publishing** — word counts, character
   limits, array lengths, emoji absence, and `image_data` completeness for the selected
   template. Empty-string `ifempty()` fallbacks currently let a blank poster publish.
8. **No brand-kit indirection exists.** Colours, fonts, logo glyph and wordmark are
   hard-coded across five variables. A multi-tenant port needs these as inputs; the
   palette in section 9 is this brand's saved identity and must survive verbatim.
9. **Drop or implement Twitter.** Do not keep paying tokens for `twitter_post`.
10. **No `BUSINESS:` block.** Nothing in the prompt carries phone, address, email or
    service area, so the copy cannot cite contact details. That is a deliberate
    difference from the contractor scenarios, not an omission in this extraction.
