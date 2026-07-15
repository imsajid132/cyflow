/**
 * Split Comparison.
 *
 * For "comparison" posts: two stacked panels set the options against each
 * other, the right-hand one carrying the brand colour so the preferred answer
 * is obvious without saying so. Structure encodes the argument.
 *
 * With no comparison data the layout falls back to a headline + subheadline
 * card, so a generation miss never produces an empty split.
 */

import { logo, eyebrow, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'split-comparison';
export const label = 'Split Comparison';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const compare = text.comparison || null;
  const hasCompare = Boolean(compare && (compare.leftTitle || compare.rightTitle));

  const column = (side, title, items) => `
    <div class="col col-${side}">
      ${title ? `<span class="col-title">${title}</span>` : ''}
      ${
        Array.isArray(items) && items.length
          ? `<ul class="col-list">${items.map((i) => `<li class="col-item">${i}</li>`).join('')}</ul>`
          : ''
      }
    </div>`;

  const body = hasCompare
    ? `<div class="compare">
         ${column('a', compare.leftTitle, compare.leftItems)}
         <span class="versus">vs</span>
         ${column('b', compare.rightTitle, compare.rightItems)}
       </div>`
    : subheadline(text.sub);

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="shape shape-disc wash"></div>
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
          ${cta(text.cta)}
        </div>
        <footer class="foot">
          ${footerLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .wash { width: 560px; height: 560px; right: -220px; top: -200px; background: ${c.brandSoft}; opacity: .5; }
    .tpl-${id} .content { padding: 88px; gap: 30px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 24px; min-height: 72px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 30px; }
    .tpl-${id} .headline { font-size: ${Math.round(ctx.type.headline.size * 0.66)}px; max-width: 18ch; }

    .tpl-${id} .compare { display: flex; align-items: stretch; gap: 20px; }
    .tpl-${id} .col {
      flex: 1; display: flex; flex-direction: column; gap: 14px;
      padding: 30px 28px; border-radius: 20px; min-height: 240px;
    }
    /* The neutral option is quiet; the brand option carries the colour. */
    .tpl-${id} .col-a { background: ${c.surface}; border: 1px solid ${c.hairline}; }
    .tpl-${id} .col-b { background: ${c.brand}; }
    .tpl-${id} .col-title {
      font-family: ${ctx.fonts.utility}; font-size: 22px; font-weight: 800;
      letter-spacing: .12em; text-transform: uppercase; color: ${c.muted};
    }
    .tpl-${id} .col-b .col-title { color: ${c.onBrand}; opacity: .82; }
    .tpl-${id} .col-list { list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .tpl-${id} .col-item { font-size: 25px; line-height: 1.3; color: ${c.ink}; font-weight: 500; }
    .tpl-${id} .col-b .col-item { color: ${c.onBrand}; }
    .tpl-${id} .versus {
      align-self: center; flex: 0 0 auto;
      width: 58px; height: 58px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: ${c.accent}; color: ${c.onAccent};
      font-family: ${ctx.fonts.utility}; font-size: 20px; font-weight: 800;
      text-transform: uppercase; letter-spacing: .02em;
    }
    .tpl-${id} .foot { display: flex; align-items: flex-end; }
  `;

  return { html, css };
}

export default { id, label, render };
