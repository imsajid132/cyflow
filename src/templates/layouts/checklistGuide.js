/**
 * Checklist Guide.
 *
 * For checklist and process posts: 3–5 rows in real cards, sized to stay
 * readable at feed scale. The check marks are drawn in CSS (a rotated
 * border-corner), so no icon font or image is fetched.
 *
 * Falls back to the subheadline when no items were generated, rather than
 * rendering an empty frame.
 */

import { logo, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'checklist-guide';
export const label = 'Checklist Guide';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const items = Array.isArray(text.bullets) ? text.bullets.slice(0, 5) : [];

  const rows = items
    .map(
      (item) =>
        `<li class="row"><span class="tick-chip"><span class="tick"></span></span>` +
        `<span class="row-text">${item}</span></li>`,
    )
    .join('');

  const body = rows ? `<ul class="list">${rows}</ul>` : subheadline(text.sub);

  /*
   * The cap is a real flex block that CONTAINS the header and headline, not an
   * absolutely positioned band of fixed height behind them. A fixed band cannot
   * know how many lines the headline takes, so a long headline overflowed it and
   * rendered white-on-white.
   */
  const html = `
    <div class="canvas tpl-${id}">
      <div class="grid-field"></div>
      <div class="content">
        <div class="cap">
          <header class="head">
            ${logo(logoUrl)}
            <span class="spacer"></span>
            ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
          </header>
          <h1 class="headline">${text.headline}</h1>
        </div>
        <div class="body">${body}</div>
        <footer class="foot">
          <div class="foot-row">
            ${footerLockup(text)}
            <span class="spacer"></span>
            ${cta(text.cta)}
          </div>
        </footer>
      </div>
    </div>`;

  // Row height adapts to the count so 5 items stay as readable as 3.
  const rowPad = items.length >= 5 ? 18 : items.length === 4 ? 22 : 26;
  const rowFont = items.length >= 5 ? 27 : 29;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .content { padding: 0; }
    /* The brand cap sizes itself to the header + headline it contains. */
    .tpl-${id} .cap {
      background: ${c.brand}; padding: 66px 76px 44px;
      display: flex; flex-direction: column; gap: 22px;
      border-bottom: 8px solid ${c.accent};
    }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 52px; }
    .tpl-${id} .logo { height: 50px; max-width: 200px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 9px 20px; border-radius: 999px;
      border: 1.5px solid ${c.accent}; color: ${c.accent};
      font-family: ${ctx.fonts.utility}; font-size: 19px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase; white-space: nowrap;
    }
    .tpl-${id} .headline {
      color: ${c.onBrand}; font-size: ${Math.round(ctx.type.headline.size * 0.58)}px;
      max-width: 24ch; font-weight: 700;
    }
    /* The grid starts below the brand cap; it is a treatment for the light
       field, and the cap is already a filled area. */
    .tpl-${id} .grid-field { z-index: 0; }
    .tpl-${id} .cap, .tpl-${id} .body, .tpl-${id} .foot { position: relative; z-index: 3; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; padding: 34px 76px 24px; }
    /*
     * The rows FILL the field rather than floating in the middle of it.
     *
     * They used to be centred at their natural height, which left roughly 150px
     * of flat empty canvas above and below them: five rows occupying the middle
     * 40% of the card and nothing anchoring the rest. Growing them to share the
     * body height keeps three rows and five rows equally deliberate, and the cap
     * is bounded so a short list becomes generous rather than absurd.
     */
    .tpl-${id} .list { list-style: none; flex: 1; display: flex; flex-direction: column; gap: 14px; }
    .tpl-${id} .row {
      flex: 1 1 0; max-height: 124px;
      display: flex; align-items: center; gap: 22px;
      padding: ${rowPad}px 28px; border-radius: 16px;
      background: ${c.surface}; border: 1px solid ${c.hairline};
    }
    /*
     * A filled chip carrying the tick, rather than a bare tick on the row.
     *
     * The tick used to be drawn in accentOnWash: the accent darkened until it
     * could be seen on a near-white row, which for a yellow brand is an olive
     * nobody chose. On a brand-coloured chip the accent can be itself. It has
     * huge contrast on a dark field, it reads as the brand, and it keeps the
     * accent to the small area it is supposed to occupy.
     */
    .tpl-${id} .tick-chip {
      flex: 0 0 42px; width: 42px; height: 42px; border-radius: 11px;
      background: ${c.brand}; display: flex; align-items: center; justify-content: center;
    }
    /* A CSS tick: two borders on a rotated box. No icon asset is fetched. */
    .tpl-${id} .tick {
      width: 20px; height: 11px;
      border-left: 4px solid ${c.accent}; border-bottom: 4px solid ${c.accent};
      transform: rotate(-45deg); margin-top: -5px;
    }
    .tpl-${id} .row-text { font-size: ${rowFont}px; line-height: 1.3; color: ${c.ink}; font-weight: 500; }
    .tpl-${id} .subheadline { color: ${c.muted}; font-size: 30px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 18px; padding: 0 76px 60px; }
    .tpl-${id} .foot-row { display: flex; align-items: center; gap: 18px; }
    .tpl-${id} .footer { font-size: 20px; }
    .tpl-${id} .brandname { font-size: 21px; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; }
  `;

  return { html, css };
}

export default { id, label, render };
