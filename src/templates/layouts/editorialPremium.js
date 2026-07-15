/**
 * Clean Editorial Premium.
 *
 * An asymmetric editorial page: a full-height brand rule pins the left edge and
 * every block hangs off it, so the eye runs eyebrow → headline → copy → CTA →
 * footer down a single strong axis. The logo sits top-right, opposite the rule,
 * to balance the composition without crowding the headline.
 */

import { logo, eyebrow, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'editorial-premium';
export const label = 'Clean Editorial Premium';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="edge-rule"></div>
        <div class="shape shape-disc corner-wash"></div>
      </div>
      <div class="content">
        <header class="head">
          ${eyebrow(text.eyebrow)}
          ${logo(logoUrl, { align: 'right' })}
        </header>
        <div class="body">
          <h1 class="headline">${text.headline}</h1>
          <div class="rule"></div>
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
    .tpl-${id} .edge-rule {
      position: absolute; left: 0; top: 0; bottom: 0; width: 18px;
      background: linear-gradient(180deg, ${c.brand} 0%, ${c.accent} 100%);
    }
    .tpl-${id} .corner-wash {
      width: 620px; height: 620px; right: -220px; top: -240px;
      background: ${c.brandSoft}; opacity: .55;
    }
    .tpl-${id} .content { padding: 92px 92px 82px 110px; }
    .tpl-${id} .head { display: flex; align-items: center; justify-content: space-between; gap: 32px; min-height: 72px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 34px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 26px; }
  `;

  return { html, css };
}

export default { id, label, render };
