/**
 * The Make-derived poster family.
 *
 * These eight layouts reproduce the compositions from the Make.com
 * "Daily Content Generator" cards (see design-references/make-scenario/extracted),
 * natively and driven by the workspace's own brand. The Make scenarios shipped
 * one hardcoded HTML card per concept, in a fixed red-and-navy skin, with a
 * CSS-text wordmark. Here the SAME compositions, spacing, type hierarchy, blocks
 * and footer lockups are rebuilt against the palette roles, so only the colours,
 * the logo and the copy change per business.
 *
 * Structure follows the source exactly: a 1080 field, an 80px inset, a header
 * (mark left, category badge right), an eyebrow rule, a headline carrying one
 * accent emphasis, one content block, and a two-sided footer over a hairline.
 * The content block is what distinguishes the concepts, which is the Make design:
 * a stat day is a mega figure, a cheatsheet is five numbered tips, a service day
 * is problem/solution/result.
 *
 * Two Make choices are deliberately NOT carried over: the hardcoded "NYC"
 * wordmark becomes the real logo (or a brand-name treatment when none exists),
 * and the fabricated five-star testimonial becomes a real-review-only card that
 * simply does not render without a stored review.
 */

import { logo } from '../parts.js';

/* --------------------------------------------------------------- shared chrome */

/**
 * The header: the brand mark on the left, a category badge on the right.
 *
 * The Make cards set a letterspaced CSS wordmark here. Cyflow prefers the real
 * logo; with none, the business name is set as a compact wordmark rather than
 * any other business's mark. The badge is the day's category, bordered on dark
 * fields and solid on light ones.
 */
function header(ctx, { badge, onLight = false }) {
  const { logoUrl, text } = ctx;
  const mark = logoUrl
    ? logo(logoUrl, { className: 'poster-logo' })
    : `<div class="poster-wordmark"><span class="poster-wordmark-name">${text.brandName || ''}</span><span class="poster-wordmark-rule"></span></div>`;
  const chip = badge
    ? `<div class="poster-badge ${onLight ? 'poster-badge-solid' : 'poster-badge-border'}">${badge}</div>`
    : '';
  return `<header class="poster-head">${mark}${chip}</header>`;
}

/** The eyebrow: an accent rule, then a letterspaced label. */
function eyebrow(label) {
  return `<div class="poster-eyebrow"><span class="poster-eyebrow-rule"></span>${label ? `<span class="poster-eyebrow-label">${label}</span>` : ''}</div>`;
}

/**
 * The headline, carrying exactly one accent emphasis on its second part.
 *
 * The Make headline is two lines with the second in the accent colour. When a
 * `highlight` is supplied it becomes the accent span on its own line; otherwise
 * the whole headline is set plain, which is the honest fallback rather than
 * colouring an arbitrary word.
 */
function headline(ctx, { highlight }) {
  const h = ctx.text.headline || '';
  // A self-closing break, because the HTML sanitizer normalises <br> to <br/>
  // and a raw <br> would make a card's pre- and post-sanitize markup differ
  // for no real reason.
  if (highlight) {
    return `<h1 class="poster-headline">${h}<br/><span class="poster-accent">${highlight}</span></h1>`;
  }
  return `<h1 class="poster-headline">${h}</h1>`;
}

/** The two-sided footer over a hairline: a supporting note left, contact right. */
function footer(ctx, { left, right }) {
  const { text } = ctx;
  const l = left || text.brandName || '';
  const r = right || text.website || text.phone || '';
  return `<footer class="poster-foot"><div class="poster-hairline"></div><div class="poster-foot-row"><span class="poster-foot-left">${l}</span><span class="poster-foot-right">${r}</span></div></footer>`;
}

/**
 * The shared poster stylesheet, tokenised from the Make `shared_css`.
 *
 * Every hardcoded Make hex is replaced by a palette role: the navy field becomes
 * the brand gradient, the red accent becomes the accent, white ink becomes
 * onBrand, and the muted greys become onBrand at reduced opacity (the ink-opacity
 * hierarchy the reference grammar uses instead of more hues). A light variant
 * flips to a near-white surface with dark ink for the cheatsheet and comparison,
 * exactly as the source alternated light and dark cards across the week.
 */
function chromeCss(ctx, { variant }) {
  const { palette: c, fonts, scope: s } = ctx;
  const dark = variant !== 'light';
  const field = variant === 'accent'
    ? `linear-gradient(135deg, ${c.accent} 0%, ${c.accentOnWash} 55%, ${c.accent} 100%)`
    : variant === 'light'
      ? '#F7F8FA'
      : `linear-gradient(135deg, ${c.brand} 0%, ${c.brandDeep} 55%, ${c.brand} 100%)`;
  // Ink roles per variant. Near-black is always permissible as ink on a light
  // surface (per the design rules), so the light card takes a near-black ink
  // whatever the brand hue, keeping the tip list legible.
  const ink = variant === 'accent' ? c.onAccent : variant === 'light' ? '#0B1220' : c.onBrand;
  const ink75 = variant === 'light' ? 'rgba(11,18,32,0.72)' : `rgba(255,255,255,0.75)`;
  const ink55 = variant === 'light' ? 'rgba(11,18,32,0.5)' : `rgba(255,255,255,0.55)`;
  const accent = c.accent;
  // On an accent field the accent-coloured emphasis would vanish; use ink there.
  const emphasis = variant === 'accent' ? ink : accent;
  const panelBg = variant === 'light' ? '#FFFFFF' : 'rgba(255,255,255,0.06)';
  const panelEdge = accent;

  return `
    ${s} { background: ${field}; color: ${ink}; }
    ${s} .content { padding: 80px; }
    ${s} .poster { display: flex; flex-direction: column; justify-content: space-between; height: 100%; position: relative; z-index: 3; }
    ${s} .poster-mid { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 30px; min-height: 0; }

    /* field treatment: a faint accent grid + a soft corner glow, from the source */
    ${s} .poster-grid {
      position: absolute; inset: 0; z-index: 1; pointer-events: none;
      background-image:
        repeating-linear-gradient(to right, ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(11,18,32,0.05)'} 0 1px, transparent 1px 60px),
        repeating-linear-gradient(to bottom, ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(11,18,32,0.05)'} 0 1px, transparent 1px 60px);
    }
    ${s} .poster-glow {
      position: absolute; top: -220px; right: -220px; width: 640px; height: 640px; z-index: 1;
      border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle, ${dark ? hexA(accent, 0.22) : hexA(accent, 0.14)} 0%, transparent 70%);
    }
    ${s} .poster-topbar { position: absolute; top: 0; left: 0; width: 100%; height: 12px; background: ${accent}; z-index: 4; }

    /* header */
    ${s} .poster-head { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 3; }
    ${s} .poster-logo { height: 58px; max-width: 300px; object-fit: contain; object-position: left center; }
    ${s} .poster-wordmark { display: flex; flex-direction: column; gap: 10px; }
    ${s} .poster-wordmark-name { font-family: ${fonts.display}; font-size: 40px; font-weight: 800; letter-spacing: -0.5px; color: ${ink}; line-height: 1; }
    ${s} .poster-wordmark-rule { width: 64px; height: 6px; border-radius: 6px; background: ${accent}; }
    ${s} .poster-badge { font-family: ${fonts.utility}; font-size: 17px; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase; padding: 11px 22px; }
    ${s} .poster-badge-border { background: ${hexA(accent, 0.15)}; border: 2px solid ${accent}; color: ${ink}; }
    ${s} .poster-badge-solid { background: ${accent}; color: ${c.onAccent}; }

    /* eyebrow */
    ${s} .poster-eyebrow { display: flex; align-items: center; gap: 16px; }
    ${s} .poster-eyebrow-rule { width: 40px; height: 6px; border-radius: 6px; background: ${accent}; flex: 0 0 40px; }
    ${s} .poster-eyebrow-label { font-family: ${fonts.utility}; font-size: 20px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; color: ${variant === 'accent' ? ink : accentReadable(c, variant)}; }

    /* headline */
    ${s} .poster-headline { font-family: ${fonts.display}; font-size: 78px; font-weight: 800; line-height: 1.04; letter-spacing: -2px; color: ${ink}; text-wrap: balance; }
    ${s} .poster-accent { color: ${emphasis}; }

    /* footer */
    ${s} .poster-foot { position: relative; z-index: 3; }
    ${s} .poster-hairline { height: 2px; width: 100%; background: ${dark ? hexA(accent, 0.4) : 'rgba(11,18,32,0.12)'}; margin-bottom: 22px; }
    ${s} .poster-foot-row { display: flex; justify-content: space-between; align-items: center; }
    ${s} .poster-foot-left { font-family: ${fonts.utility}; font-size: 21px; font-weight: 600; color: ${ink55}; letter-spacing: 0.5px; }
    ${s} .poster-foot-right { font-family: ${fonts.utility}; font-size: 22px; font-weight: 800; color: ${accent === ink ? ink : accentReadable(c, variant)}; letter-spacing: 0.5px; }

    /* shared block primitives, reused by several bodies */
    ${s} .poster-block { background: ${panelBg}; border-left: 6px solid ${panelEdge}; padding: 22px 28px; ${variant === 'light' ? 'box-shadow: 0 4px 14px rgba(11,18,32,0.06);' : ''} }
    ${s} .poster-block-label { font-family: ${fonts.utility}; font-size: 17px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: ${accentReadable(c, variant)}; margin-bottom: 8px; }
    ${s} .poster-block-text { font-size: 27px; font-weight: 700; line-height: 1.32; color: ${variant === 'light' ? '#0B1220' : ink}; }
    ${s} .poster-tagrow { display: flex; gap: 14px; flex-wrap: wrap; }
    ${s} .poster-tag { background: ${hexA(accent, 0.18)}; color: ${ink}; padding: 10px 20px; font-family: ${fonts.utility}; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
    ${s} .poster-ink75 { color: ${ink75}; }
  `;
}

/* Colour helpers ---------------------------------------------------------- */

/** #rrggbb + alpha → rgba(). Input is a validated palette hex. */
function hexA(hex, a) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * An accent shade that stays legible for small text on this variant's field.
 *
 * A chromatic accent bright enough to be an accent can be too light for small
 * caps on a dark field or too pale on white. The palette already computes a
 * wash-readable accent; on a dark field the raw accent usually reads, on a light
 * field the wash-readable one does. Never introduces a new hue.
 */
function accentReadable(c, variant) {
  if (variant === 'light') return c.accentOnWash || c.accent;
  return c.accent;
}

/**
 * Assemble a poster: field + grid + glow + top bar, then the body between the
 * header and footer. Every body is handed the same chrome so the family reads as
 * one system, which is exactly how the Make shared_css worked.
 */
function shell(ctx, { variant, topbar = true }, inner) {
  // The outer element MUST carry the scope class the CSS is scoped to
  // (ctx.scope is ".tpl-poster-x"); without it none of the base or chrome rules
  // match and the card renders as raw unstyled text.
  const scopeClass = ctx.scope.replace(/^\./, '');
  return `
    <div class="canvas ${scopeClass}">
      <div class="content">
        <div class="poster-grid"></div>
        <div class="poster-glow"></div>
        ${topbar ? '<div class="poster-topbar"></div>' : ''}
        <div class="poster">${inner}</div>
      </div>
    </div>`;
}

function makePoster(id, label, { variant, topbar = true, body, css }) {
  function render(ctx) {
    const inner = body(ctx);
    return {
      html: shell(ctx, { variant, topbar }, inner),
      css: `${chromeCss(ctx, { variant })}\n${css ? css(ctx) : ''}`,
    };
  }
  return { id, label, render };
}

/* ------------------------------------------------------------- the eight cards */

// 1. SERVICE — problem / solution / result blocks + a tag row.
export const posterService = makePoster('poster-service', 'Poster · Service', {
  variant: 'dark',
  body(ctx) {
    const p = ctx.text.poster?.service || {};
    const blocks = [
      ['The problem', p.problem],
      ['Our solution', p.solution],
      ['The result', p.result],
    ].filter(([, v]) => v);
    const badge = ctx.text.badge || 'Service';
    return `
      ${header(ctx, { badge })}
      <div class="poster-mid">
        ${eyebrow(ctx.text.tag || 'Expert service')}
        ${headline(ctx, { highlight: ctx.text.emphasisPhrase })}
        <div class="poster-blocks">
          ${blocks.map(([l, v]) => `<div class="poster-block"><div class="poster-block-label">${l}</div><div class="poster-block-text">${v}</div></div>`).join('')}
          ${(p.tags || []).length ? `<div class="poster-tagrow">${p.tags.map((t) => `<div class="poster-tag">● ${t}</div>`).join('')}</div>` : ''}
        </div>
      </div>
      ${footer(ctx, { left: ctx.text.tag || 'Serving your area', right: ctx.text.phone || ctx.text.website })}`;
  },
  css: (ctx) => `${ctx.scope} .poster-blocks { display: flex; flex-direction: column; gap: 16px; }`,
});

// 2. STAT — one mega figure, a description, trust badges. Real figure only.
export const posterStat = makePoster('poster-stat', 'Poster · Stat', {
  variant: 'dark',
  body(ctx) {
    const st = ctx.text.poster?.stat;
    // No real figure: fall back to a plain statement so the card is never a
    // fabricated number. This mirrors the "no stat without a supplied figure"
    // rule the reference review enforces.
    if (!st) {
      return `${header(ctx, { badge: ctx.text.badge || 'Proof' })}<div class="poster-mid">${eyebrow('Why it matters')}${headline(ctx, { highlight: ctx.text.emphasisPhrase })}</div>${footer(ctx, { right: ctx.text.phone || ctx.text.website })}`;
    }
    return `
      ${header(ctx, { badge: ctx.text.badge || 'Proof' })}
      <div class="poster-mid poster-stat-mid">
        ${eyebrow(st.overline || 'By the numbers')}
        <div class="poster-megastat">${st.bigStat}</div>
        ${st.statDesc ? `<div class="poster-statdesc">${st.statDesc}</div>` : ''}
        ${(st.badges || []).length ? `<div class="poster-badgerow">${st.badges.map((b) => `<div class="poster-trustbadge">${b}</div>`).join('')}</div>` : ''}
      </div>
      ${footer(ctx, { left: ctx.text.brandName, right: ctx.text.website || ctx.text.phone })}`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    return `
      ${s} .poster-stat-mid { justify-content: center; }
      ${s} .poster-megastat { font-family: ${fonts.display}; font-size: 300px; font-weight: 800; line-height: 0.9; letter-spacing: -12px; color: ${c.onBrand}; }
      ${s} .poster-statdesc { font-size: 38px; line-height: 1.3; font-weight: 500; color: rgba(255,255,255,0.75); max-width: 820px; margin-top: 8px; }
      ${s} .poster-badgerow { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 34px; }
      ${s} .poster-trustbadge { background: ${hexA(c.accent, 0.15)}; border-left: 6px solid ${c.accent}; padding: 14px 24px; font-family: ${fonts.utility}; font-size: 20px; font-weight: 800; letter-spacing: 2px; color: ${c.onBrand}; }
    `;
  },
});

// 3. CHEATSHEET — a two-line title over five numbered tips, each with a subtitle. Light card.
export const posterCheatsheet = makePoster('poster-cheatsheet', 'Poster · Cheatsheet', {
  variant: 'light',
  body(ctx) {
    const cs = ctx.text.poster?.cheatsheet;
    const tips = cs?.tips || [];
    return `
      ${header(ctx, { badge: ctx.text.badge || 'Cheatsheet', onLight: true })}
      <div class="poster-mid poster-cheat-mid">
        ${eyebrow(cs?.overline || 'Quick guide')}
        ${headline(ctx, { highlight: cs?.highlight || ctx.text.emphasisPhrase })}
        <div class="poster-tips">
          ${tips.map((t, i) => `<div class="poster-tip"><div class="poster-tipnum">${String(i + 1).padStart(2, '0')}</div><div class="poster-tipbody"><span class="poster-tipmain">${t.main}</span>${t.sub ? `<span class="poster-tipsub">${t.sub}</span>` : ''}</div></div>`).join('')}
        </div>
      </div>
      ${footer(ctx, { left: ctx.text.brandName, right: ctx.text.website || ctx.text.phone })}`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    return `
      ${s} .poster-cheat-mid { justify-content: flex-start; gap: 24px; }
      ${s} .poster-headline { font-size: 62px; }
      ${s} .poster-tips { display: flex; flex-direction: column; gap: 12px; }
      ${s} .poster-tip { background: #FFFFFF; border-left: 8px solid ${c.accent}; padding: 18px 24px; display: flex; gap: 20px; align-items: center; box-shadow: 0 4px 12px rgba(11,18,32,0.06); }
      ${s} .poster-tipnum { background: #0B1220; color: #FFFFFF; min-width: 56px; height: 56px; font-family: ${fonts.display}; font-size: 22px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      ${s} .poster-tipbody { display: flex; flex-direction: column; gap: 3px; }
      ${s} .poster-tipmain { font-size: 27px; font-weight: 800; color: #0B1220; line-height: 1.22; }
      ${s} .poster-tipsub { font-size: 18px; font-weight: 500; color: rgba(11,18,32,0.55); line-height: 1.3; }
    `;
  },
});

// 4. PROJECT — three ordered details + a timeline / result meta pair.
export const posterProject = makePoster('poster-project', 'Poster · Project', {
  variant: 'dark',
  body(ctx) {
    const pr = ctx.text.poster?.project || {};
    const details = pr.details || [];
    return `
      ${header(ctx, { badge: ctx.text.badge || 'Process' })}
      <div class="poster-mid">
        ${eyebrow('How it works')}
        ${headline(ctx, { highlight: pr.location || ctx.text.emphasisPhrase })}
        <div class="poster-details">
          ${details.map((d, i) => `<div class="poster-detail"><div class="poster-detailnum">${String(i + 1).padStart(2, '0')}</div><div class="poster-detailtext">${d}</div></div>`).join('')}
          ${(pr.timeline || pr.result) ? `<div class="poster-meta">${pr.timeline ? `<div class="poster-metacell"><div class="poster-block-label">Timeline</div><div class="poster-metaval">${pr.timeline}</div></div>` : ''}${(pr.timeline && pr.result) ? '<div class="poster-metadiv"></div>' : ''}${pr.result ? `<div class="poster-metacell"><div class="poster-block-label">Result</div><div class="poster-metaval">${pr.result}</div></div>` : ''}</div>` : ''}
        </div>
      </div>
      ${footer(ctx, { left: ctx.text.tag || ctx.text.brandName, right: ctx.text.phone || ctx.text.website })}`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    return `
      ${s} .poster-details { display: flex; flex-direction: column; gap: 16px; }
      ${s} .poster-detail { display: flex; align-items: center; gap: 20px; background: rgba(255,255,255,0.05); border-left: 6px solid ${c.accent}; padding: 20px 26px; }
      ${s} .poster-detailnum { background: ${c.accent}; color: ${c.onAccent}; min-width: 54px; height: 54px; font-family: ${fonts.display}; font-size: 21px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
      ${s} .poster-detailtext { font-size: 26px; font-weight: 600; line-height: 1.3; color: ${c.onBrand}; }
      ${s} .poster-meta { display: flex; align-items: center; gap: 30px; background: ${hexA(c.accent, 0.12)}; border: 2px solid ${hexA(c.accent, 0.4)}; padding: 22px 30px; margin-top: 4px; }
      ${s} .poster-metacell { flex: 1; }
      ${s} .poster-metaval { font-size: 28px; font-weight: 800; color: ${c.onBrand}; line-height: 1.2; }
      ${s} .poster-metadiv { width: 2px; height: 56px; background: ${hexA(c.accent, 0.4)}; }
    `;
  },
});

// 5. WARNING — a named mistake, its consequence, the fix, and a pro-tip bar.
export const posterWarning = makePoster('poster-warning', 'Poster · Warning', {
  variant: 'dark',
  body(ctx) {
    const w = ctx.text.poster?.warning || {};
    return `
      ${header(ctx, { badge: ctx.text.badge || 'Warning' })}
      <div class="poster-mid">
        ${eyebrow('Common mistake')}
        ${headline(ctx, { highlight: w.highlight || ctx.text.emphasisPhrase })}
        <div class="poster-blocks">
          ${w.mistake ? `<div class="poster-block"><div class="poster-block-label">The mistake</div><div class="poster-block-text">${w.mistake}</div></div>` : ''}
          ${w.consequence ? `<div class="poster-block poster-block-warn"><div class="poster-block-label">Consequence</div><div class="poster-block-text">${w.consequence}</div></div>` : ''}
          ${w.fix ? `<div class="poster-block poster-block-fix"><div class="poster-block-label poster-label-good">Do this instead</div><div class="poster-block-text">${w.fix}</div></div>` : ''}
          ${w.proTip ? `<div class="poster-protip"><span class="poster-protip-label">Pro tip</span> ${w.proTip}</div>` : ''}
        </div>
      </div>
      ${footer(ctx, { left: 'Avoid costly mistakes', right: ctx.text.phone || ctx.text.website })}`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    // A single supportive green for the "do this" block is a semantic signal,
    // not a brand hue; kept muted and used only here.
    const good = '#22C55E';
    return `
      ${s} .poster-blocks { display: flex; flex-direction: column; gap: 14px; }
      ${s} .poster-block-warn { background: ${hexA(c.accent, 0.15)}; }
      ${s} .poster-block-fix { background: rgba(34,197,94,0.12); border-left-color: ${good}; }
      ${s} .poster-label-good { color: ${good}; }
      ${s} .poster-protip { background: ${hexA(c.accent, 0.2)}; border: 2px solid ${hexA(c.accent, 0.5)}; padding: 18px 24px; font-size: 22px; font-weight: 600; line-height: 1.4; color: ${c.onBrand}; margin-top: 4px; }
      ${s} .poster-protip-label { font-family: ${fonts.utility}; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: ${accentReadable(c, 'dark')}; margin-right: 8px; }
    `;
  },
});

// 6. QUOTE — a centred two-part statement with one accent half + a supporting line.
export const posterQuote = makePoster('poster-quote', 'Poster · Statement', {
  variant: 'dark',
  body(ctx) {
    const q = ctx.text.poster?.quote;
    const part1 = q?.part1 || ctx.text.headline || '';
    const part2 = q?.part2 || '';
    const sub = q?.subquote || ctx.text.sub || '';
    return `
      ${header(ctx, { badge: ctx.text.badge || 'Our approach' })}
      <div class="poster-mid poster-quote-mid">
        <div class="poster-quote-rule"></div>
        <h1 class="poster-headline poster-quote-text">${part1}${part2 ? ` <span class="poster-accent">${part2}</span>` : ''}</h1>
        ${sub ? `<div class="poster-quote-sub">${sub}</div>` : ''}
      </div>
      ${footer(ctx, { left: ctx.text.brandName, right: ctx.text.website || ctx.text.phone })}`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    return `
      ${s} .poster-quote-mid { justify-content: center; gap: 26px; max-width: 880px; }
      ${s} .poster-quote-rule { width: 80px; height: 8px; border-radius: 8px; background: ${c.accent}; }
      ${s} .poster-quote-text { font-family: ${fonts.display}; font-size: 92px; font-weight: 800; line-height: 1.05; letter-spacing: -3px; color: ${c.onBrand}; }
      ${s} .poster-quote-sub { font-size: 32px; line-height: 1.4; font-weight: 500; color: rgba(255,255,255,0.75); max-width: 760px; }
    `;
  },
});

// 7. COMPARISON — two labelled columns (old vs new, myth vs reality). Light card.
export const posterComparison = makePoster('poster-comparison', 'Poster · Comparison', {
  variant: 'light',
  body(ctx) {
    const cmp = ctx.text.comparison;
    const col = (title, items, accent) => `
      <div class="poster-col ${accent ? 'poster-col-accent' : ''}">
        <div class="poster-coltitle">${title || ''}</div>
        <div class="poster-colitems">${(items || []).map((it) => `<div class="poster-colitem">${it}</div>`).join('')}</div>
      </div>`;
    return `
      ${header(ctx, { badge: ctx.text.badge || 'Comparison', onLight: true })}
      <div class="poster-mid poster-cmp-mid">
        ${eyebrow('Side by side')}
        ${headline(ctx, { highlight: ctx.text.emphasisPhrase })}
        ${cmp ? `<div class="poster-cols">${col(cmp.leftTitle, cmp.leftItems, false)}${col(cmp.rightTitle, cmp.rightItems, true)}</div>` : ''}
      </div>
      ${footer(ctx, { left: ctx.text.brandName, right: ctx.text.website || ctx.text.phone })}`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    return `
      ${s} .poster-cmp-mid { justify-content: flex-start; gap: 22px; }
      ${s} .poster-headline { font-size: 60px; }
      ${s} .poster-cols { display: flex; gap: 20px; }
      ${s} .poster-col { flex: 1; background: #FFFFFF; padding: 28px 26px; box-shadow: 0 4px 14px rgba(11,18,32,0.06); }
      ${s} .poster-col-accent { border-top: 8px solid ${c.accent}; }
      ${s} .poster-col:not(.poster-col-accent) { border-top: 8px solid rgba(11,18,32,0.18); }
      ${s} .poster-coltitle { font-family: ${fonts.utility}; font-size: 22px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #0B1220; margin-bottom: 18px; }
      ${s} .poster-colitems { display: flex; flex-direction: column; gap: 12px; }
      ${s} .poster-colitem { font-size: 25px; font-weight: 600; line-height: 1.3; color: rgba(11,18,32,0.8); }
    `;
  },
});

// 8. TESTIMONIAL — a real stored review only. Renders nothing inventive.
export const posterTestimonial = makePoster('poster-testimonial', 'Poster · Review', {
  variant: 'accent',
  body(ctx) {
    const t = ctx.text.poster?.testimonial;
    // With no real review the card falls back to a plain statement, because the
    // week resolver only routes a testimonial slot here when a review exists;
    // this is defence in depth against ever showing an empty or invented review.
    if (!t) {
      return `${header(ctx, { badge: 'Review' })}<div class="poster-mid poster-quote-mid"><h1 class="poster-headline poster-quote-text">${ctx.text.headline || ''}</h1></div>${footer(ctx, { left: ctx.text.brandName, right: ctx.text.website })}`;
    }
    return `
      ${header(ctx, { badge: 'Customer review' })}
      <div class="poster-mid poster-review-mid">
        <h1 class="poster-headline poster-review-quote">${t.quote}</h1>
      </div>
      <footer class="poster-foot">
        <div class="poster-hairline"></div>
        <div class="poster-review-foot">
          <div class="poster-review-author">
            <div class="poster-review-initials">${t.initials}</div>
            <div class="poster-review-who"><span class="poster-review-name">${t.author}</span>${t.location ? `<span class="poster-review-loc">${t.location}</span>` : ''}</div>
          </div>
          <span class="poster-foot-right">${ctx.text.website || ctx.text.phone || ''}</span>
        </div>
      </footer>`;
  },
  css: (ctx) => {
    const { palette: c, fonts, scope: s } = ctx;
    const ink = c.onAccent;
    return `
      ${s} .poster-review-mid { justify-content: center; }
      ${s} .poster-review-quote { font-family: ${fonts.display}; font-size: 64px; font-weight: 800; line-height: 1.18; letter-spacing: -1.5px; color: ${ink}; }
      ${s} .poster-review-foot { display: flex; justify-content: space-between; align-items: center; }
      ${s} .poster-review-author { display: flex; align-items: center; gap: 18px; }
      ${s} .poster-review-initials { width: 60px; height: 60px; border-radius: 50%; background: rgba(0,0,0,0.22); border: 2px solid rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center; font-family: ${fonts.display}; font-size: 22px; font-weight: 800; color: ${ink}; }
      ${s} .poster-review-who { display: flex; flex-direction: column; }
      ${s} .poster-review-name { font-size: 24px; font-weight: 800; color: ${ink}; }
      ${s} .poster-review-loc { font-size: 18px; font-weight: 500; color: rgba(255,255,255,0.85); }
    `;
  },
});

export default {
  posterService, posterStat, posterCheatsheet, posterProject,
  posterWarning, posterQuote, posterComparison, posterTestimonial,
};
