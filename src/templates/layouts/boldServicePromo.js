/**
 * Bold Service Promo.
 *
 * A full-bleed brand field with a diagonal cut across the lower third: the
 * headline sits in the colour, the CTA and contact details sit in the calm band
 * below it. Built for one loud offer — the promo that has to win the scroll.
 */

import { logo, eyebrow, cta, subheadline, contactLockup } from '../parts.js';

export const id = 'bold-service-promo';
export const label = 'Bold Service Promo';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="field"></div>
        <div class="shape shape-disc glow"></div>
      </div>
      <div class="content">
        <header class="head">
          ${eyebrow(text.eyebrow, 'on-field')}
          ${logo(logoUrl, { align: 'right' })}
        </header>
        <div class="body">
          <h1 class="headline">${text.headline}</h1>
          ${subheadline(text.sub)}
        </div>
        <footer class="foot">
          ${cta(text.cta)}
          <span class="spacer"></span>
          ${contactLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    /* The diagonal is a clip-path, not a rotated block: the cut is defined in
       percentages of the canvas, so text can never be overrun by it. */
    .tpl-${id} .field {
      position: absolute; inset: 0;
      background: linear-gradient(155deg, ${c.brand} 0%, ${c.brandDeep} 100%);
      clip-path: polygon(0 0, 100% 0, 100% 68%, 0 80%);
    }
    .tpl-${id} .glow {
      width: 520px; height: 520px; right: -140px; top: -160px;
      background: ${c.accent}; opacity: .28;
    }
    .tpl-${id} .content { padding: 88px 92px 84px; }
    .tpl-${id} .head { display: flex; align-items: center; justify-content: space-between; gap: 32px; min-height: 72px; }
    .tpl-${id} .eyebrow.on-field { color: ${c.onBrand}; opacity: .82; }
    .tpl-${id} .headline {
      color: ${c.onBrand}; text-transform: uppercase; font-weight: 800;
      letter-spacing: -.02em; max-width: 15ch;
    }
    .tpl-${id} .subheadline { color: ${c.onBrand}; opacity: .86; font-weight: 500; max-width: 24ch; }
    /* Ends above the shallowest point of the cut (68% on the right edge). */
    .tpl-${id} .body {
      flex: 1; display: flex; flex-direction: column; justify-content: center;
      gap: 28px; padding-bottom: 180px;
    }
    .tpl-${id} .foot { display: flex; align-items: center; gap: 24px; }
    .tpl-${id} .footer { color: ${c.muted}; }
  `;

  return { html, css };
}

export default { id, label, render };
