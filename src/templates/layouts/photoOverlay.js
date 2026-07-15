/**
 * Photo Overlay Ready.
 *
 * Carried forward from Phase 4.5b and restyled onto the new design system.
 * `.photo-slot` is a real, dedicated background-image element for a future
 * image provider; until one is integrated it renders a layered brand wash, and
 * no photo is ever invented. The scrim and the bottom-weighted lockup are sized
 * for a photograph, so dropping one in later needs no layout change.
 */

import { logo, eyebrow, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'photo-overlay';
export const label = 'Photo Overlay Ready';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="photo-slot"></div>
        <div class="shape shape-arc slot-arc"></div>
        <div class="scrim"></div>
      </div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${eyebrow(text.eyebrow, 'on-scrim')}
        </header>
        <div class="body">
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
    /* The slot a future image provider fills. Brand-tinted until then. */
    .tpl-${id} .photo-slot {
      position: absolute; inset: 0; z-index: 0;
      background: linear-gradient(150deg, ${c.brand} 0%, ${c.brandDeep} 55%, ${c.support} 100%);
    }
    .tpl-${id} .slot-arc {
      width: 900px; height: 900px; left: -220px; top: -300px;
      border-width: 120px; border-color: ${c.onBrand}; opacity: .1; z-index: 1;
    }
    .tpl-${id} .scrim {
      position: absolute; inset: 0; z-index: 2;
      background: linear-gradient(180deg, rgba(10, 12, 20, .18) 0%, rgba(10, 12, 20, .52) 52%, rgba(10, 12, 20, .84) 100%);
    }
    .tpl-${id} .content { padding: 88px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 24px; min-height: 72px; }
    .tpl-${id} .eyebrow.on-scrim { color: #ffffff; opacity: .85; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 28px; padding-bottom: 44px; }
    .tpl-${id} .headline { color: #ffffff; max-width: 16ch; }
    .tpl-${id} .subheadline { color: #ffffff; opacity: .88; max-width: 28ch; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 24px; }
    .tpl-${id} .hairline { background: rgba(255, 255, 255, .28); }
    .tpl-${id} .footer { color: rgba(255, 255, 255, .9); }
    .tpl-${id} .brandname { color: #ffffff; }
  `;

  return { html, css };
}

export default { id, label, render };
