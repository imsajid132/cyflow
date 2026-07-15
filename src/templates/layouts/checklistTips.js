/**
 * Checklist Tips.
 *
 * For "tips" posts: the message IS a list, so the layout is a list. Each row is
 * a numbered marker plus a short line — numbering is used here precisely
 * because the content is an ordered set of steps, not decoration.
 *
 * Falls back to the subheadline when no bullets were generated, so the layout
 * degrades to a plain editorial card rather than an empty frame.
 */

import { logo, eyebrow, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'checklist-tips';
export const label = 'Checklist Tips';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const bullets = Array.isArray(text.bullets) ? text.bullets : [];

  const rows = bullets
    .map(
      (item, i) => `
      <li class="row">
        <span class="marker">${i + 1}</span>
        <span class="row-text">${item}</span>
      </li>`,
    )
    .join('');

  const body = rows
    ? `<ul class="list">${rows}</ul>`
    : subheadline(text.sub);

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="shape shape-bar top-bar"></div>
        <div class="shape shape-disc corner"></div>
      </div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${eyebrow(text.eyebrow)}
        </header>
        <div class="body">
          <h1 class="headline">${text.headline}</h1>
          ${body}
        </div>
        <footer class="foot">
          ${cta(text.cta)}
          <span class="spacer"></span>
          ${footerLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .top-bar { left: 92px; right: 92px; top: 0; height: 10px; background: ${c.accent}; border-radius: 0 0 10px 10px; }
    .tpl-${id} .corner { width: 460px; height: 460px; right: -190px; bottom: -190px; background: ${c.brandSoft}; opacity: .6; }
    .tpl-${id} .content { padding: 92px; gap: 38px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 24px; min-height: 72px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 34px; }
    /* The list carries the detail, so the headline yields space to it. */
    .tpl-${id} .headline { font-size: ${Math.round(ctx.type.headline.size * 0.72)}px; max-width: 18ch; }
    .tpl-${id} .list { list-style: none; display: flex; flex-direction: column; gap: 20px; }
    .tpl-${id} .row { display: flex; align-items: center; gap: 22px; }
    .tpl-${id} .marker {
      flex: 0 0 52px; width: 52px; height: 52px; border-radius: 14px;
      display: inline-flex; align-items: center; justify-content: center;
      background: ${c.brand}; color: ${c.onBrand};
      font-family: ${ctx.fonts.utility}; font-size: 24px; font-weight: 800;
    }
    .tpl-${id} .row-text { font-size: 30px; line-height: 1.3; color: ${c.ink}; font-weight: 500; }
    .tpl-${id} .foot { display: flex; align-items: center; gap: 24px; }
  `;

  return { html, css };
}

export default { id, label, render };
