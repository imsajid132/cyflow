/**
 * Stat Proof.
 *
 * For "proof" posts: one number does the persuading, so it is set enormous and
 * everything else supports it. The stat is only ever a figure the business
 * supplied or the copy generator derived from their own brief — nothing here
 * invents a result.
 *
 * With no stat, the layout falls back to a headline-led card rather than
 * rendering an empty number.
 */

import { logo, eyebrow, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'stat-proof';
export const label = 'Stat Proof';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const hasStat = Boolean(text.statValue);

  const statBlock = hasStat
    ? `<div class="stat">
         <span class="stat-value">${text.statValue}</span>
         ${text.statLabel ? `<span class="stat-label">${text.statLabel}</span>` : ''}
       </div>`
    : '';

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="shape shape-arc halo"></div>
        <div class="shape shape-disc pip"></div>
      </div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${eyebrow(text.eyebrow)}
        </header>
        <div class="body">
          ${statBlock}
          <h1 class="headline">${text.headline}</h1>
          ${subheadline(text.sub)}
          ${cta(text.cta)}
        </div>
        <footer class="foot">
          <div class="hairline"></div>
          ${footerLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .halo {
      width: 680px; height: 680px; left: -200px; top: -220px;
      border-width: 76px; border-color: ${c.brand}; opacity: .12;
    }
    .tpl-${id} .pip { width: 34px; height: 34px; right: 150px; top: 320px; background: ${c.accent}; opacity: .85; }
    .tpl-${id} .content { padding: 92px; gap: 30px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 24px; min-height: 72px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
    .tpl-${id} .stat { display: flex; flex-direction: column; gap: 12px; }
    /* line-height 1 (not <1): a tighter box lets tall glyphs collide with the
       label beneath. The wash-readable shade keeps the figure visible in dark
       mode, where the raw brand can vanish into the canvas. */
    .tpl-${id} .stat-value {
      font-family: ${ctx.fonts.display}; font-size: 190px; font-weight: 800;
      line-height: 1; letter-spacing: -.04em; color: ${c.brandOnWash};
    }
    .tpl-${id} .stat-label {
      font-family: ${ctx.fonts.utility}; font-size: 24px; font-weight: 700;
      letter-spacing: .16em; text-transform: uppercase; color: ${c.muted};
    }
    /* The number is the hero; the headline is its caption. */
    .tpl-${id} .headline { font-size: ${Math.round(ctx.type.headline.size * 0.6)}px; max-width: 20ch; }
    .tpl-${id} .subheadline { max-width: 26ch; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 24px; }
  `;

  return { html, css };
}

export default { id, label, render };
