# UI-DESIGN.md — Cyflow

The visual identity for Cyflow's frontend (Phase 6). Every colour, type, and
component decision derives from here. The brief: **vivid lime-green world, pure
black text, heavy frosted glass.** Follow it exactly.

---

## Direction

Cyflow is a Make-style automation builder that should feel **bright, physical,
and premium** — an acid-lime field with thick frosted-glass panels floating on
top of it, like glass tiles on a lime table. The green is the *world*; the glass
is where work happens; black text keeps it razor-sharp and readable. The
signature is the **module bubble**: a circular frosted-glass orb sitting on the
lime field, joined to the next by an ink-black curved link.

Spend the boldness on the lime + glass. Keep everything else quiet: disciplined
spacing, one display face used with restraint, black text doing the heavy lifting.

---

## Colour tokens

Sampled from the brand post. Use these CSS variables everywhere — no ad-hoc hex.

```css
:root {
  /* Signature lime (the world) */
  --lime:         #9DDE1E;   /* primary brand green (from the post) */
  --lime-bright:  #B4F227;   /* hover, focus glow, active state */
  --lime-deep:    #6FA011;   /* pressed, deep borders, shade */
  /* Ambient background gradient (adds depth vs flat green) */
  --bg-1:         #A8E63A;   /* top-left */
  --bg-2:         #8AC70F;   /* bottom-right */

  /* Ink (text + dark surfaces / chips) */
  --ink:          #0A0A0A;   /* primary text, dark chips */
  --ink-soft:     #1A1A1A;   /* secondary dark surfaces */
  --ink-70:       rgba(10,10,10,0.70);  /* dark glass chip fill */
  --ink-mute:     rgba(10,10,10,0.55);  /* secondary text on glass */

  /* Light frosted glass (the panels) */
  --glass-fill:   rgba(255,255,255,0.14);
  --glass-fill-2: rgba(255,255,255,0.22);  /* raised / hovered panels */
  --glass-brdr:   rgba(255,255,255,0.30);
  --glass-hi:     rgba(255,255,255,0.55);   /* top inner highlight */

  /* Utility */
  --white:        #FFFFFF;
  --danger:       #FF4D4D;   /* errors (kept off-brand-on-purpose, used sparingly) */
  --radius:       20px;      /* panels */
  --radius-pill:  999px;     /* chips, bubbles */
}
```

Rules:
- **Text is black (`--ink`) by default.** White text ONLY inside dark chips /
  `--ink` surfaces.
- Lime is the background and the accent — never use lime *as text on green*.
- `--danger` is the only non-lime colour, only for real errors. Nothing else
  introduces new hues.

---

## The glass recipe (heavy frosted glass)

This is the core surface. Two variants: light glass (panels) and dark glass
(chips/badges, matching the post's black checklist chips).

```css
/* Light frosted panel — the main work surfaces */
.glass {
  background: var(--glass-fill);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border: 1px solid var(--glass-brdr);
  border-radius: var(--radius);
  box-shadow:
    0 10px 40px rgba(10,10,10,0.18),      /* lift off the lime */
    inset 0 1px 0 var(--glass-hi);         /* glossy top edge */
}
.glass:hover { background: var(--glass-fill-2); }

/* Dark glass chip — badges, status pills, checklist items (post style) */
.chip {
  background: var(--ink-70);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: var(--white);
  border-radius: var(--radius-pill);
  padding: 6px 14px;
  font-weight: 600;
}
.chip .check { color: var(--lime); }   /* lime tick, like the post */
```

Ambient background (behind everything):
```css
body {
  background:
    radial-gradient(120% 120% at 15% 10%, var(--bg-1), var(--bg-2));
  min-height: 100vh;
  color: var(--ink);
}
```

Guardrails so "heavy glass" stays usable:
- Blur 14–24px. Below 12 looks cheap; above 28 turns to mud.
- Never stack a glass panel directly on another glass panel — put lime space
  between, or the blur compounds into grey soup.
- Keep text on light glass **black**, never grey-on-glass (fails contrast).

---

## Typography

Distinctive but tool-appropriate. Three roles:

```
Display : "Space Grotesk"  — headings, module titles. Techy, geometric,
                              a little quirky. Used with restraint.
Body    : "Inter"          — UI text, labels, descriptions. Neutral workhorse.
Data    : "JetBrains Mono"  — mappings {{1.email}}, JSON, operation counts,
                              webhook URLs. Mono because these ARE code —
                              the typeface encodes that truth.
```

```css
--font-display: "Space Grotesk", system-ui, sans-serif;
--font-body:    "Inter", system-ui, sans-serif;
--font-data:    "JetBrains Mono", ui-monospace, monospace;
```

Scale (rem): 2.5 / 1.75 / 1.25 / 1 / 0.875 / 0.75. Display weights 600–700,
body 400–500, black text throughout. Headings tight (`letter-spacing: -0.02em`).

---

## Component recipes

**Module bubble** ⭐ (the signature element)
- Circular, ~88px, `.glass` with `border-radius: var(--radius-pill)`.
- App icon centred, black. Module name in Space Grotesk below the bubble, black.
- Connected to the next bubble by an **ink-black curved link** (SVG bezier,
  2px, `--ink`).
- **Active during "Run once" replay:** lime glow ring
  `box-shadow: 0 0 0 3px var(--lime-bright), 0 0 24px var(--lime)`.
- Error state: swap glow ring to `--danger`.

**Canvas** — the lime ambient background; bubbles + links float on it. This is
where the lime is most visible; panels sit at the edges.

**Left rail / toolbar** — a tall `.glass` panel; app list, black icons.

**Right config panel** — a `.glass` panel; the form for the selected module.
Inputs are inset glass:
```css
.input {
  background: rgba(255,255,255,0.30);
  border: 1px solid var(--glass-brdr);
  border-radius: 12px; padding: 10px 12px; color: var(--ink);
}
.input:focus { outline: 2px solid var(--lime-bright); }
```

**Primary button** — solid ink on lime world (max contrast, like the post's
black chips): `background: var(--ink); color: var(--white);` pill, weight 600.
Hover lifts with a lime glow `box-shadow: 0 6px 20px rgba(157,222,30,0.5)`.

**Secondary button** — `.glass` pill, black text.

**Status pills** — dark `.chip`: success shows a `--lime` tick; running shows a
pulsing lime dot; failed shows `--danger`.

**Mapping token** — inline `.chip` in `--font-data`, e.g. `{{1.email}}`, lime
text on ink. Clicking an earlier module's output field inserts one of these.

---

## Motion (restrained)

- Bubbles: gentle scale-up on hover (`transform: scale(1.04)`, 150ms ease).
- "Run once" replay: the lime glow travels bubble → bubble in sequence as each
  runs — the one orchestrated moment, and it's meaningful (shows execution flow).
- Respect `prefers-reduced-motion`: drop the travelling glow, keep instant states.
- Nothing else animates. No decorative floating, no gradient shimmer.

---

## Quality floor

Responsive to mobile (rail collapses to a bottom sheet), visible keyboard focus
(the `--lime-bright` outline), black-on-glass contrast checked, reduced-motion
honoured. Empty states are invitations ("No scenarios yet — build your first"),
errors say what broke and how to fix it, in Cyflow's voice.

---

## Don't

- No grey text on glass. Black or white only.
- No second accent colour. Lime + ink + glass is the whole system.
- No flat opaque cards — surfaces are glass or they're `--ink`. Nothing in
  between.
- No lime text on the lime background.
- No stacking glass on glass without lime breathing room between.
