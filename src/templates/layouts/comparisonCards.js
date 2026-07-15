/**
 * Comparison Cards.
 *
 * Two meaningful columns for comparison and myth/fact posts. The right column
 * carries the brand canvas colour so the preferred answer is legible without
 * being stated; the left stays neutral. No decorative geometry — the structure
 * IS the argument.
 */

import { logo, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'comparison-cards';
export const label = 'Comparison Cards';

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
         ${column('b', compare.rightTitle, compare.rightItems)}
       </div>`
    : subheadline(text.sub);

  const html = `
    <div class="canvas tpl-${id}">
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
        </header>
        <h1 class="headline">${text.headline}</h1>
        <div class="body">${body}</div>
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

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .content { padding: 80px 76px 76px; gap: 24px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 56px; }
    .tpl-${id} .logo { height: 52px; max-width: 200px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 9px 20px; border-radius: 999px;
      background: ${c.brand}; color: ${c.onBrand};
      font-family: ${ctx.fonts.utility}; font-size: 19px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
    }
    .tpl-${id} .headline {
      color: ${c.ink}; font-size: ${Math.round(ctx.type.headline.size * 0.62)}px;
      max-width: 19ch; font-weight: 700;
    }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
    /* Sized to its content and centred. Stretching the columns to fill the card
       only moved the empty space inside them. */
    .tpl-${id} .compare { display: flex; align-items: stretch; gap: 22px; flex: 0 0 auto; }
    /* The columns stretch to fill the body rather than floating in the middle
       of it, which is what left the card looking half-empty. */
    /* A floor height so the pair reads as two substantial panels rather than
       two labels floating in a large card. */
    .tpl-${id} .col {
      flex: 1; display: flex; flex-direction: column; gap: 18px;
      padding: 40px 34px; border-radius: 20px; min-height: 380px;
    }
    .tpl-${id} .col-a { background: ${c.surface}; border: 1px solid ${c.hairline}; }
    /* The brand colour marks the recommended column. */
    .tpl-${id} .col-b { background: ${c.brand}; }
    .tpl-${id} .col-title {
      font-family: ${ctx.fonts.utility}; font-size: 21px; font-weight: 800;
      letter-spacing: .1em; text-transform: uppercase; color: ${c.muted};
      padding-bottom: 12px; border-bottom: 1px solid ${c.hairline};
    }
    .tpl-${id} .col-b .col-title { color: ${c.accent}; border-bottom-color: ${c.accent}; opacity: 1; }
    .tpl-${id} .col-list { list-style: none; display: flex; flex-direction: column; gap: 18px; }
    .tpl-${id} .col-item { font-size: 28px; line-height: 1.32; color: ${c.ink}; font-weight: 500; }
    .tpl-${id} .col-b .col-item { color: ${c.onBrand}; }
    .tpl-${id} .subheadline { color: ${c.muted}; font-size: 30px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 18px; }
    .tpl-${id} .foot-row { display: flex; align-items: center; gap: 18px; }
    .tpl-${id} .footer { font-size: 20px; }
    .tpl-${id} .brandname { font-size: 21px; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; }
  `;

  return { html, css };
}

export default { id, label, render };
