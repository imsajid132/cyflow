---
name: cyflow-saas-ux
description: Design, build or review any Cyflow application UI — the authenticated shell, auth and onboarding, planner, create, calendar, queue, brand, connections, settings. Use whenever a route, component, state or token under public/ is created or changed. Enforces the Cyflow application design system, the app-brand versus customer-brand separation, honest UI copy, accessibility, and a rendered multi-viewport review before approval.
---

# Cyflow SaaS UX

This is a paid product used by non-technical business owners whose own brand is
on the output. The interface has to feel calm, professional and trustworthy, and
it has to be honest about what the product actually does.

Workflows live here. `CLAUDE.md` carries only the permanent one-line rules.

## 1. The two brands. Never mix them.

This is the rule most likely to be broken, and the most damaging when it is.

**Cyflow application brand** — the green `cf` mark. It belongs on:
login, register, the sidebar, mobile nav, favicon, app icon, loading states,
app-level empty states, application page chrome.

**Customer business brand** — the user's logo, saved colours, fonts, business
name. It belongs on **generated social creatives**, and nothing else does.

- Never place the Cyflow mark on a customer's generated post.
- Never let Cyflow green override a customer's saved palette.
- The app chrome *around* a preview is Cyflow-branded. The creative *inside* it
  is customer-branded. That boundary is the product.

The mark is `public/assets/brand/cyflow-mark*.png`. It is pure `#1f9e5b` with
only alpha varying, built by `tools/build-logo.mjs` from the source in
`design-references/brand/`. **Never serve the source**: it is colour type 2 with
a baked checkerboard and no alpha channel.

## 2. Colour

The application green is `#1f9e5b`, sampled from the mark itself
(`public/assets/brand/brand-green.json`), not from memory.

Use semantic tokens, never raw hex in a component. Green is for: primary actions,
active nav, progress, selected state, focus, positive status. That is all.

- **Do not** cover the app in green. Green is the accent on a neutral field.
- **Do not** use blue or purple as a primary or fallback brand colour. Blue is
  permitted only for an informational status and must not dominate.
- Status must never be colour alone: pair it with text or an icon.

## 3. Honesty rules

These are product rules, not style preferences. Breaking one is a bug.

- **No fake data.** No invented charts, growth metrics, engagement numbers,
  trends, testimonials, customer counts or activity. If there is no real data,
  design the empty state.
- **Nothing publishes to a provider yet.** Never imply a post was published, will
  auto-publish, or that autopilot is live. "Queued" and "Scheduled" are true;
  "Published" is not.
- **Only three providers exist**: Facebook Pages, Instagram Professional,
  Threads. Never show another, not even greyed out as "coming soon".
- **No placeholder shipped**: no lorem, no TODO, no dead control.
- **A hard failure says so.** Never dress a generation failure as "Needs review".

## 4. Terminology

User-facing text says **post copy**, and **Facebook post** / **Instagram post** /
**Threads post**. Never "caption" — that word is what produced one-line adverts.
Internal field names (`caption`, `platformCaptions`) stay as they are.

## 5. Layout

A left sidebar, a flexible main area, a consistent page header per route.

Width follows the work, not a single global max-width:

| Route | Width |
| --- | --- |
| dashboard, connections | medium-wide |
| planner board, calendar, create | wide |
| forms, settings, profile | readable constrained |

**Page header standard**: title, one concise description, primary action where
relevant. No decorative hero inside the app. One `h1` per page.

## 6. Components

One version of each control. If a second appears, the first was wrong.

Every reusable component needs: default, hover, focus, active, disabled, plus
loading and error where relevant, plus mobile behaviour, keyboard support and an
accessible name.

Shape: small controls 8–10px, buttons/inputs 10–12px, cards 14–18px, modals
18–24px. Pills are for badges and tags only — not every element.

Shadows are for things that float: modal, drawer, popover, active preview. Not
for every card. Borders do the ordinary separating.

## 7. Motion

120–220ms transitions, drawer/modal/toast entrances, tab underline, skeleton
shimmer. Nothing that floats, bounces, rotates or slows routine work.

`prefers-reduced-motion` must leave the app fully usable.

## 8. States. Every route needs all four.

- **Loading** — skeletons shaped like the real layout. For long generation, real
  stage text, not a spinner alone.
- **Empty** — explain, then give one clear next action. A new user's dashboard is
  an onboarding path, not blank cards.
- **Error** — friendly summary, safe detail, a retry. Never a stack trace, raw
  provider text, database text or a secret. Technical detail goes in an
  expandable section.
- **Destructive** — an accessible confirmation naming the consequence, safe
  default focus, a way out.

## 9. Accessibility

Non-negotiable: semantic headings, one logical `h1`, explicit labels, keyboard
reachable, visible focus, focus trapped in modals/drawers, Escape closes, focus
returns to the trigger, AA contrast, no colour-only status, `aria-live` for async
status, meaningful alt text (decorative images hidden), real touch targets.

## 10. Security in the UI

- Never `innerHTML` with untrusted values. Use `textContent` / safe DOM APIs.
- Never put secrets, tokens or generated private content in `localStorage` or
  `sessionStorage`.
- Never prefill a secret field. Mask stored credentials.
- Preserve same-origin sessions, CSRF, ownership checks.

## 11. Reject on sight

- an admin-template or Bootstrap-panel look
- a wall of white cards
- a purple AI-startup clone
- gradient-heavy or animation-heavy chrome
- dense walls of controls with no grouping
- giant empty sections
- decorative UI with no function
- tiny body copy, or headings that eat the viewport
- raw backend error text
- a route that still looks like the old interface

## 12. Review before approving. Rendering is the review.

Reading CSS is not review. Bugs here have twice been invisible in code and
obvious in a render.

1. Run the app and drive the real route. Do not screenshot a static mock.
2. Capture **1440x900, 1280x800, 1024x768, 390x844, 360x800**.
3. Screenshot with headless Chrome at a **true viewport**. Never CSS-scale a
   page or an iframe as final evidence — scaling aliases hairlines and either
   invents defects or hides them.
4. Look at every screenshot at full resolution.
5. Check the console and network panel. A clean render with a red console is a
   fail.
6. Keyboard-only pass: tab through, confirm focus is visible and ordered.

Reject a screenshot that hides overflow by cropping, still shows skeletons,
contains broken images, shows placeholder presented as real, or shows the
checkerboard source.

## 13. Report honestly

State what you rendered, at which viewports, and what is still weak. Never call a
UI "premium" or "polished" unless you rendered it and looked. If something was
not verified — no live model, no HCTI key, a route not driven — say so plainly
rather than implying it passed.

A green test suite is not evidence of design quality. **Tests do not look at
pictures.**
