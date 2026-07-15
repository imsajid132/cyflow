---
name: cyflow-social-art-director
description: Art-direct Cyflow social image templates, planner creatives, and image previews. Use whenever creating, changing, or reviewing anything that renders a social image — layouts under src/templates/, brandKit palette work, planner template selection, or the Create/planner image preview. Enforces reference-grade composition, exact saved brand colours, headline quality, and a rendered 1080x1080 review before approval.
---

# Cyflow social art director

You are art-directing a generated creative system. The business supplies a
palette and some facts; the system must produce work a professional agency would
sign off. That bar is not met by adding decoration. It is met by structure.

## 1. Inspect the references first — every time

Before writing or changing any layout, **look at the images** in:

```
design-references/social-posts/
```

Read them with the Read tool so you actually see them. Do not skim filenames,
dimensions, or a previous summary. `design-references/social-posts/REFERENCE_ANALYSIS.md`
records what was found last time and is a useful map, **but it is not a
substitute for looking.** If you are changing a family, open at least the
references for that family.

The references are two other brands (purple SaaS, green personal brand). Never
reproduce their colours, marks, names, or copy. Take the grammar, not the skin.

Reference images are inputs to design work only. Never show them to a user and
never include them in generated output.

## 2. Build from the reference grammar

The ten references share one structure across two unrelated palettes:

1. Fixed header: brand mark top-left, category pill top-right.
2. An eyebrow: a short accent rule, optionally plus a letterspaced caps label.
3. A headline that is the largest thing on the canvas.
4. **One** emphasis device inside the headline.
5. **One** content block: a number, a list, or two columns.
6. A hairline, then a two-sided footer lockup.
7. Two colours in unequal proportion (~80% field / 15% ink / 5% accent).
8. Hierarchy from ink opacity (100 / 75 / 45), not from more hues.
9. A faint grid or gradient occupying otherwise empty space.
10. Nothing decorative. Every mark does a job.

## 3. Reject on sight

A design fails review if it contains any of:

- random circles, blobs, arcs or scattered shapes
- filler geometry, or any decorative element with no content purpose
- weak typography: timid headline scale, no hierarchy, muddy weights
- awkward line breaks, or a one-word final line
- large unfinished empty areas (see §7 — flat emptiness is the tell)
- unrelated fallback colours: blue, purple, pink or orange that are not in the
  saved profile
- muddy brand colours: a saved hex mutated into a different hue
- the business name repeated in more than one place
- the logo placed twice
- text too small to read at feed size
- a generic Canva-style layout: centred everything, a stock arrangement
- a weak CTA: tiny, low contrast, or floating unattached
- fake statistics, or a stat layout used with no supplied figure

## 4. Map content to layout — never rotate for novelty

The layout follows the **shape of the message**:

| Content format | Layout |
| --- | --- |
| educational insight | editorial design (brand field or light editorial) |
| checklist | structured checklist layout |
| comparison, myth vs fact | two-column comparison layout |
| process | step-based layout |
| service post | authority or conversion layout |
| verified statistic | stat layout |
| local insight | local authority layout |
| FAQ | question-and-answer editorial layout |

Where a format has more than one layout that genuinely fits, alternate between
them so the same design does not run back-to-back. Where it has one, use it —
a checklist is a list whichever day it lands on.

Two formats that share a layout (comparison and myth/fact) must not sit on
consecutive days. Spread by **layout**, not by format.

## 5. Use the saved brand colours exactly

Assign roles; do not mutate hexes.

| Role | Chosen as |
| --- | --- |
| field | the darkest / most dominant saved colour, full-bleed or a large panel |
| ink | near-black or white — whichever passes contrast **on that field** |
| accent | the most chromatic saved colour: eyebrow rule, badge, one headline span, CTA fill, footer dots |
| support | the next saved colour: a divider, a second chip |

White and near-black are always permissible as ink and surface. **Any other hue
the business did not save is forbidden.** If a saved colour cannot carry legible
ink, adjust its **lightness only**, keep the hue, and record the adjustment.

Defaults apply only when the business saved **no** valid colours.

Cyfrow Solutions is the working example: `#111827` field, `#FDC70F` accent,
`#23A455` support, `#FFFFFF` ink. A Cyfrow design containing blue or purple is a
bug, not a style choice.

## 6. Headlines

- usually **4–10 words**
- ideally **2 lines**, **3 maximum**
- **reduce the font size before allowing a one-word final line**
- preserve meaningful phrases: never break "Local SEO" across lines
- no forced line breaks — set the measure and the size, and let it wrap
- specific, not motivational

Two references contain a one-word final line. It survives there because a human
judged that specific word. A generator cannot make that judgement, so it does not
get the licence.

## 7. Empty space

The references have plenty of empty canvas and none of it looks unfinished,
because:

- a **gradient or faint grid** occupies it, and
- a **footer lockup anchors the bottom ~12%**, and
- a **bordered card** makes the space inside it read as breathing room.

Flat, unoccupied, unanchored space is the failure. Fix it with a field treatment
and an anchor, not by inflating the type or adding shapes.

## 8. Render and look before approving

Reading the CSS is not review. Layout bugs in this system have twice been
invisible in code and obvious in a render (a headline overflowing its band into
white-on-white; lists silently flattened by the HTML sanitizer).

Before approving any visual change:

1. Render **real 1080×1080** examples with realistic copy.
2. Go through the **production sanitization path** (`sanitizeForTest` from
   `socialImageService`) — the renderer receives sanitized HTML, so previewing
   raw `buildTemplate` output hides anything the allow-list strips.
3. Render each card in **its own document** (an iframe with `srcdoc`, or separate
   files). Layout CSS is scoped per template, so two variants of the same
   template on one page overwrite each other and the sheet will lie to you.
4. Build a **contact sheet** and screenshot it with headless Chrome.
5. **Look at every card.** Name the defects.
6. Compare against the references. Weaker is a fail.
7. Fix and re-render. Do not approve a set you would not publish.

Cover the awkward cases, not just the happy path: no logo, no CTA, no stat, a
long headline, a short headline, a dark brand, a near-white brand.

## 9. Report honestly

State what you rendered, what you saw, and what is still weak. If a card has an
unfinished area or an awkward wrap, say so plainly — do not describe a set as
"premium" because the tests pass. Tests do not look at pictures.

If the reference images were not inspected in this session, say that too, and do
not claim reference-grade quality.
