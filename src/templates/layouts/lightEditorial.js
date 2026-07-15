/**
 * Light Editorial — the quiet counterpart to Editorial Insight.
 *
 * A clean light canvas, a bold headline with one brand-colour emphasis, a
 * controlled badge, and a subtle divider and footer. Used so that a plan does
 * not become seven dark cards in a row; the same brand colours appear, but as
 * marks on a light field rather than as the field itself.
 */

import { logo, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'light-editorial';
export const label = 'Light Editorial';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="rail"></div>
      </div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
        </header>
        <div class="body">
          <h1 class="headline">${text.headline}</h1>
          <div class="divider"></div>
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
    /* A single brand rail: the one place the canvas colour appears at scale. */
    .tpl-${id} .rail {
      position: absolute; left: 0; top: 0; bottom: 0; width: 22px;
      background: ${c.brand};
    }
    .tpl-${id} .content { padding: 96px 88px 84px 110px; gap: 30px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 64px; }
    .tpl-${id} .logo { height: 56px; max-width: 220px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 9px 20px; border-radius: 999px;
      background: ${c.brand}; color: ${c.onBrand};
      font-family: ${ctx.fonts.utility}; font-size: 19px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
    }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 24px; align-items: flex-start; }
    /* A wider measure lets a 5-7 word headline settle on two lines rather than
       three with one word stranded. */
    .tpl-${id} .headline { color: ${c.ink}; max-width: 20ch; font-weight: 700; }
    .tpl-${id} .headline .em { color: ${c.accentOnWash}; }
    .tpl-${id} .divider { width: 96px; height: 5px; border-radius: 5px; background: ${c.accent}; }
    .tpl-${id} .subheadline { color: ${c.muted}; max-width: 32ch; font-size: 29px; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 24px; padding: 16px 32px; margin-top: 6px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 20px; }
    .tpl-${id} .footer { font-size: 21px; }
    .tpl-${id} .brandname { font-size: 22px; }
  `;

  return { html, css };
}

export default { id, label, render };
