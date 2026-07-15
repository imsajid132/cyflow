/**
 * Minimal Luxury Card.
 *
 * A thin double frame, centred type, and a lot of air. Restraint is the whole
 * point here: an outlined CTA and a hairline ornament instead of a filled
 * button and shapes. This is the template for brands whose value is quietness —
 * clinics, studios, consultancies.
 */

import { logo, cta, subheadline, contactLockup } from '../parts.js';

export const id = 'minimal-luxury';
export const label = 'Minimal Luxury Card';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="frame-outer"></div>
        <div class="frame-inner"></div>
      </div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl, { className: 'logo-center' })}
          ${text.eyebrow ? `<span class="eyebrow">${text.eyebrow}</span>` : ''}
        </header>
        <div class="body">
          <div class="ornament">
            <span class="orn-line"></span>
            <span class="orn-mark"></span>
            <span class="orn-line"></span>
          </div>
          <h1 class="headline">${text.headline}</h1>
          ${subheadline(text.sub)}
          ${cta(text.cta, 'cta-outline')}
        </div>
        <footer class="foot">
          ${contactLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.surface}; }
    .tpl-${id} .frame-outer { position: absolute; inset: 44px; border: 1px solid ${c.hairline}; }
    .tpl-${id} .frame-inner { position: absolute; inset: 58px; border: 3px solid ${c.brand}; opacity: .18; }
    .tpl-${id} .content { padding: 130px 120px; align-items: center; text-align: center; }
    .tpl-${id} .head { display: flex; flex-direction: column; align-items: center; gap: 26px; }
    .tpl-${id} .logo-center { object-position: center; margin: 0 auto; height: 64px; }
    .tpl-${id} .eyebrow { color: ${c.muted}; letter-spacing: .34em; font-size: 19px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px; }
    .tpl-${id} .ornament { display: flex; align-items: center; gap: 16px; }
    .tpl-${id} .orn-line { width: 68px; height: 1px; background: ${c.hairline}; }
    .tpl-${id} .orn-mark { width: 10px; height: 10px; background: ${c.accent}; transform: rotate(45deg); }
    .tpl-${id} .headline { max-width: 16ch; font-weight: 500; letter-spacing: -.01em; }
    .tpl-${id} .subheadline { max-width: 32ch; }
    .tpl-${id} .cta { align-self: center; border-color: ${c.brand}; color: ${c.brandDeep}; }
    .tpl-${id} .foot { display: flex; justify-content: center; }
    .tpl-${id} .footer { justify-content: center; letter-spacing: .12em; text-transform: uppercase; font-size: 19px; }
  `;

  return { html, css };
}

export default { id, label, render };
