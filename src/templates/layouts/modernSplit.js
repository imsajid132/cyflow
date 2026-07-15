/**
 * Modern Split Layout.
 *
 * A hard vertical split: a brand-coloured panel carrying layered arcs and the
 * brand lockup on one side, the message on the other. The split does the work
 * a photo would normally do — it gives the composition a subject and a weight
 * without inventing imagery.
 */

import { logo, eyebrow, cta, subheadline, contactLockup } from '../parts.js';

export const id = 'modern-split';
export const label = 'Modern Split Layout';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="content split">
        <aside class="panel">
          <div class="shape shape-arc arc-a"></div>
          <div class="shape shape-arc arc-b"></div>
          <div class="shape shape-disc dot"></div>
          <div class="panel-foot">
            <span class="brandname on-panel">${text.brandName || ''}</span>
            ${contactLockup(text, 'on-panel')}
          </div>
        </aside>
        <section class="main">
          <header class="head">
            ${logo(logoUrl)}
            ${eyebrow(text.eyebrow)}
          </header>
          <div class="body">
            <h1 class="headline">${text.headline}</h1>
            <div class="rule"></div>
            ${subheadline(text.sub)}
          </div>
          ${cta(text.cta, 'cta-brand')}
        </section>
      </div>
    </div>`;

  const css = `
    .tpl-${id} .split { flex-direction: row; }
    .tpl-${id} .panel {
      position: relative; width: 40%; flex: 0 0 40%; overflow: hidden;
      background: linear-gradient(200deg, ${c.brand} 0%, ${c.brandDeep} 100%);
      display: flex; flex-direction: column; justify-content: flex-end; padding: 64px 52px;
    }
    .tpl-${id} .arc-a {
      width: 560px; height: 560px; left: -180px; top: -140px;
      border-width: 44px; border-color: ${c.accent}; opacity: .5;
    }
    .tpl-${id} .arc-b {
      width: 380px; height: 380px; right: -150px; top: 240px;
      border-width: 24px; border-color: ${c.onBrand}; opacity: .28;
    }
    .tpl-${id} .dot { width: 88px; height: 88px; left: 64px; top: 420px; background: ${c.accent}; opacity: .9; }
    .tpl-${id} .panel-foot { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 14px; }
    .tpl-${id} .on-panel { color: ${c.onBrand}; }
    .tpl-${id} .panel-foot .footer { color: ${c.onBrand}; opacity: .82; font-size: 20px; }
    .tpl-${id} .main {
      flex: 1; display: flex; flex-direction: column; gap: 40px;
      padding: 88px 76px 84px; background: ${c.wash};
    }
    .tpl-${id} .head { display: flex; flex-direction: column; align-items: flex-start; gap: 22px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
    .tpl-${id} .headline { max-width: 13ch; }
    .tpl-${id} .subheadline { max-width: 22ch; }
  `;

  return { html, css };
}

export default { id, label, render };
