/**
 * Numbered Steps.
 *
 * For a process: an ordered sequence where the ORDER is the point. The
 * checklist layout uses ticks, which say "done"; this uses number chips, which
 * say "first, then, then". The reference #3 numbered cheatsheet is the model:
 * a rounded number chip, a bold step title, on rows that fill the field.
 *
 * Distinct from checklist-guide in structure (numbered rail vs tick chips) and
 * in reading (a sequence vs an unordered set of checks).
 */

import { logo, cta, subheadline, footerLockup, eyebrowRule } from '../parts.js';

export const id = 'numbered-steps';
export const label = 'Numbered Steps';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const items = Array.isArray(text.bullets) ? text.bullets.slice(0, 5) : [];

  const rows = items
    .map(
      (item, i) =>
        `<li class="step"><span class="num">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="step-text">${item}</span></li>`,
    )
    .join('');

  const body = rows ? `<ol class="steps">${rows}</ol>` : subheadline(text.sub);

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
          ${eyebrowRule('', 'eyebrow-lockup-on-brand')}
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

  const stepFont = items.length >= 5 ? 27 : 30;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .grid-field { z-index: 0; }
    .tpl-${id} .content { padding: 0; position: relative; z-index: 3; }
    .tpl-${id} .cap {
      background: ${c.brand}; padding: 60px 76px 40px;
      display: flex; flex-direction: column; gap: 20px;
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
      color: ${c.onBrand}; font-size: ${Math.round(ctx.type.headline.size * 0.56)}px;
      max-width: 24ch; font-weight: 700;
    }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; padding: 34px 76px 20px; }
    .tpl-${id} .steps { list-style: none; flex: 1; display: flex; flex-direction: column; gap: 16px; counter-reset: none; }
    .tpl-${id} .step {
      flex: 1 1 0; max-height: 128px; display: flex; align-items: center; gap: 24px;
      padding-bottom: 16px; border-bottom: 1px solid ${c.hairline};
    }
    .tpl-${id} .step:last-child { border-bottom: 0; }
    /* The number is the rail the eye runs down. Brand chip, accent numeral. */
    .tpl-${id} .num {
      flex: 0 0 60px; width: 60px; height: 60px; border-radius: 14px;
      background: ${c.brand}; color: ${c.accent};
      display: flex; align-items: center; justify-content: center;
      font-family: ${ctx.fonts.display}; font-size: 26px; font-weight: 800; letter-spacing: -.02em;
    }
    .tpl-${id} .step-text { font-size: ${stepFont}px; line-height: 1.28; color: ${c.ink}; font-weight: 600; }
    .tpl-${id} .subheadline { color: ${c.muted}; font-size: 30px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 18px; padding: 0 76px 58px; }
    .tpl-${id} .foot-row { display: flex; align-items: center; gap: 18px; }
    .tpl-${id} .footer { font-size: 20px; }
    .tpl-${id} .brandname { font-size: 21px; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; }
  `;

  return { html, css };
}

export default { id, label, render };
