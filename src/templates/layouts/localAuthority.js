/**
 * Local Business Authority.
 *
 * A framed card floating on a tinted ground, with a corner ribbon and a service
 * badge. The frame and the footer rule inside it are the "credentials" cues a
 * local trade business wants — it reads as a certificate more than an ad.
 */

import { logo, cta, tag, subheadline, footerLockup } from '../parts.js';

export const id = 'local-authority';
export const label = 'Local Business Authority';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="shape shape-disc ground"></div>
      </div>
      <div class="content">
        <div class="card">
          <div class="ribbon"></div>
          <header class="head">
            ${logo(logoUrl) || `<span class="brandname">${text.brandName || ''}</span>`}
          </header>
          <div class="body">
            ${tag(text.tag)}
            <h1 class="headline">${text.headline}</h1>
            ${subheadline(text.sub)}
            ${cta(text.cta, 'cta-brand')}
          </div>
          <footer class="foot">
            <div class="hairline"></div>
            ${footerLockup(text)}
          </footer>
        </div>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.brandSoft}; }
    .tpl-${id} .ground {
      width: 900px; height: 900px; left: 50%; top: 58%; transform: translate(-50%, -50%);
      background: ${c.brand}; opacity: .1;
    }
    .tpl-${id} .content { padding: 64px; }
    .tpl-${id} .card {
      position: relative; flex: 1; display: flex; flex-direction: column;
      background: ${c.surface}; border: 1px solid ${c.hairline};
      border-radius: 28px; padding: 72px 72px 60px; overflow: hidden;
      box-shadow: 0 24px 70px ${c.brandDeep}1f;
    }
    /* Corner ribbon: a rotated square clipped by the card's overflow. */
    .tpl-${id} .ribbon {
      position: absolute; right: -70px; top: -70px; width: 190px; height: 190px;
      background: ${c.accent}; transform: rotate(45deg); opacity: .9;
    }
    /* The head stays clear of the ribbon, so the logo never collides with it. */
    .tpl-${id} .head { display: flex; align-items: center; gap: 28px; min-height: 72px; padding-right: 130px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 30px; }
    .tpl-${id} .headline { max-width: 17ch; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 24px; }
  `;

  return { html, css };
}

export default { id, label, render };
