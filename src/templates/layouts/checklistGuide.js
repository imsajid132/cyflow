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
    .map((item) => `<li class="row"><span class="tick"></span><span class="row-text">${item}</span></li>`)
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
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 40px 76px; }
    .tpl-${id} .list { list-style: none; display: flex; flex-direction: column; gap: 14px; }
    .tpl-${id} .row {
      display: flex; align-items: center; gap: 20px;
      padding: ${rowPad}px 28px; border-radius: 16px;
      background: ${c.surface}; border: 1px solid ${c.hairline};
    }
    /* A CSS tick: two borders on a rotated box. No icon asset is fetched. */
    .tpl-${id} .tick {
      flex: 0 0 26px; width: 26px; height: 14px;
      border-left: 5px solid ${c.accentOnWash}; border-bottom: 5px solid ${c.accentOnWash};
      transform: rotate(-45deg); margin-top: -6px;
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
