/**
 * Stat Highlight.
 *
 * For a verified result the business actually supplied. The generator is
 * instructed to return an EMPTY stat when the brief states no real figure, and
 * this layout falls back to a headline-led authority card in that case — so a
 * template can never invite an invented number.
 */

import { logo, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'stat-highlight';
export const label = 'Stat Highlight';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const hasStat = Boolean(text.statValue);

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer"><div class="field"></div><div class="accent-edge"></div></div>
      <div class="grid-field${c.canvasIsDark ? ' grid-field-on-brand' : ''}"></div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
        </header>
        <div class="body">
          ${
            hasStat
              ? `<div class="stat">
                   <span class="stat-value">${text.statValue}</span>
                   ${text.statLabel ? `<span class="stat-label">${text.statLabel}</span>` : ''}
                 </div>`
              : ''
          }
          <h1 class="headline">${text.headline}</h1>
          ${subheadline(text.sub)}
        </div>
        <footer class="foot">
          <div class="hairline"></div>
          <div class="foot-row">
            ${footerLockup(text)}
            <span class="spacer"></span>
            ${cta(text.cta)}
          </div>
        </footer>
      </div>
    </div>`;

  const onField = c.canvasIsDark ? c.onBrand : c.ink;
  const fieldBg = c.canvasIsDark
    ? `linear-gradient(200deg, ${c.brand} 0%, ${c.brandDeep} 100%)`
    : c.wash;

  // Without a stat the headline carries the card, so it is set larger.
  const headlineSize = hasStat
    ? Math.round(ctx.type.headline.size * 0.52)
    : Math.round(ctx.type.headline.size * 0.86);

  const css = `
    .tpl-${id} { background: ${fieldBg}; }
    .tpl-${id} .field { position: absolute; inset: 0; background: ${fieldBg}; }
    .tpl-${id} .accent-edge { position: absolute; left: 0; top: 0; bottom: 0; width: 12px; background: ${c.accent}; }
    .tpl-${id} .content { padding: 92px 84px 80px 96px; gap: 26px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 56px; }
    .tpl-${id} .logo { height: 52px; max-width: 200px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 9px 20px; border-radius: 999px;
      border: 1.5px solid ${c.accent}; color: ${c.accent};
      font-family: ${ctx.fonts.utility}; font-size: 19px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
    }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 18px; padding-bottom: 36px; }
    .tpl-${id} .stat { display: flex; flex-direction: column; gap: 10px; }
    .tpl-${id} .stat-value {
      font-family: ${ctx.fonts.display}; font-size: 210px; font-weight: 800;
      line-height: 1; letter-spacing: -.045em; color: ${c.accent};
    }
    .tpl-${id} .stat-label {
      font-family: ${ctx.fonts.utility}; font-size: 24px; font-weight: 700;
      letter-spacing: .16em; text-transform: uppercase; color: ${onField}; opacity: .7;
    }
    .tpl-${id} .headline { color: ${onField}; font-size: ${headlineSize}px; max-width: 20ch; font-weight: 700; }
    .tpl-${id} .subheadline { color: ${onField}; opacity: .7; max-width: 30ch; font-size: 27px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 18px; }
    .tpl-${id} .foot-row { display: flex; align-items: center; gap: 18px; }
    .tpl-${id} .hairline { background: ${onField}; opacity: .18; }
    .tpl-${id} .footer { color: ${onField}; opacity: .72; font-size: 20px; }
    .tpl-${id} .brandname { color: ${onField}; font-size: 21px; }
    .tpl-${id} .footer-dot { background: ${c.accent}; opacity: 1; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; }
  `;

  return { html, css };
}

export default { id, label, render };
