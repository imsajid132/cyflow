---
name: cyflow-creative-quality-gate
description: Final combined review of a Cyflow weekly plan before it is called done — post copy for every platform, visual headlines, rendered images, brand-colour fidelity, duplicate risk, and reference-quality comparison. Use after generating or materially changing planner output, and before reporting a plan or a creative change as complete. Fails the gate on generic copy, template-looking images, missing brand colours, or an unreviewed contact sheet.
---

# Cyflow creative quality gate

The last check before anyone says "done". It exists because the two things that
have actually shipped broken here — a brand colour silently turned blue, a
headline rendered white-on-white — both passed a full green test suite.

**Tests do not look at pictures and do not read for tone.** This gate does.

Run `cyflow-social-art-director` and `cyflow-social-post-writer` first; this gate
assumes their standards and checks the result as a whole.

## What to review

Review the **whole plan together**, not post by post in isolation. Most failures
here are pattern failures — seven posts that are individually acceptable and
collectively identical.

1. The full weekly plan, as a set.
2. Every Facebook post copy.
3. Every Instagram post copy.
4. Every Threads post copy.
5. Every visual headline.
6. Every generated image, rendered.
7. Exact brand-colour use.
8. Duplicate risk across the batch and against recent history.
9. Paragraph structure.
10. Comparison against `design-references/social-posts/`.
11. Visual and written consistency — do the headline and the copy work together?

## How to review

**Copy:** read all of it, in order, as a week. Line up the seven opening
sentences and look at them together. Line up the seven closings. Repetition is
visible in a column and invisible one post at a time.

**Images:** render real 1080×1080 through the production sanitization path, each
card in its own document, into a contact sheet. Screenshot it. Look at it.
See the art-director skill, §8 for the mechanics and the traps.

**Colours:** check the hexes that reach the CSS against the saved profile, not
the palette object in isolation. `palette.source` should be
`saved_brand_palette`; `palette.adjusted` should be empty or explain itself.

## Fail the gate if

Any one of these is a fail, not a note:

- **text is generic** — it would fit any business in the category
- **posts are too short without a valid reason** — under the platform's normal
  range with no format that justifies it
- **all posts use the same structure** — same opening shape, same rhythm, same close
- **copy is a single promotional paragraph** rather than a real post
- **images look like basic templates** — a stock arrangement with a logo dropped on
- **saved brand colours are missing** from the render, or a colour appears that
  the business never saved
- **the references were not inspected** in this session
- **the visual headline and the post copy are disconnected**, or say the same thing
- **an em dash or en dash exists** anywhere in the copy
- **repeated openings exist** across the week
- **duplicate layouts appear** without a content reason, or on consecutive days
- **the rendered contact sheet was not reviewed** — a claim of quality with no
  render behind it is not a claim, it is a guess

## Reporting

State plainly:

- what was rendered, and where the contact sheet is
- which references were inspected
- the exact hexes that reached the CSS, against the saved profile
- format spread across the week (how many distinct formats, how many layouts)
- every defect found, including the ones not fixed

Then give a verdict: **pass**, or **fail with the specific reasons**.

If the gate fails, fix and re-run it. Do not report a failing set as complete
with the defects listed as "limitations" — that is a fail wearing a hat.

Two honesty rules:

- Never call a set "premium", "agency-quality" or "reference-grade" unless you
  rendered it and looked. Describe what you saw.
- If something could not be verified (no live model, no real HCTI key, no
  reference inspection), say so explicitly rather than implying it passed.
