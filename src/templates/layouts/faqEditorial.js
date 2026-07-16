/**
 * FAQ Editorial.
 *
 * A question, then its answer, as two distinct blocks. The question is set as a
 * large "Q." lockup so it reads as a question at feed size; the answer sits in
 * its own card so the eye knows where the reply begins. This is a genuinely
 * different structure from the plain editorials: two stacked blocks with a
 * labelled relationship, not one headline plus a support line.
 *
 * Uses `text.answerSummary` when the generator supplies one, else the
 * subheadline. Optional answer points come from `text.bullets`.
 */

import { logo, cta, footerLockup, eyebrowRule } from '../parts.js';

export const id = 'faq-editorial';
export const label = 'FAQ Editorial';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;
  const answer = text.answerSummary || text.sub || '';
  const points = Array.isArray(text.bullets) ? text.bullets.slice(0, 3) : [];
  const pointRows = points.length
    ? `<ul class="ans-points">${points.map((p) => `<li>${p}</li>`).join('')}</ul>`
    : '';

  const html = `
    <div class="canvas tpl-${id}">
      <div class="grid-field"></div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
        </header>
        <div class="body">
          ${eyebrowRule('Question')}
          <h1 class="headline"><span class="q-mark">Q.</span> ${text.headline}</h1>
          <div class="answer">
            <span class="answer-label">Answer</span>
            ${answer ? `<p class="answer-text">${answer}</p>` : ''}
            ${pointRows}
          </div>
          ${cta(text.cta)}
        </div>
        <footer class="foot">
          <div class="hairline"></div>
          <div class="foot-row">
            ${footerLockup(text)}
            <span class="spacer"></span>
          </div>
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .grid-field { z-index: 0; }
    .tpl-${id} .content { padding: 76px 76px 68px; gap: 26px; position: relative; z-index: 3; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 56px; }
    .tpl-${id} .logo { height: 52px; max-width: 200px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 9px 20px; border-radius: 999px;
      background: ${c.brand}; color: ${c.onBrand};
      font-family: ${ctx.fonts.utility}; font-size: 19px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
    }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 28px; align-items: stretch; }
    .tpl-${id} .headline {
      color: ${c.ink}; font-size: ${Math.round(ctx.type.headline.size * 0.66)}px;
      max-width: 22ch; font-weight: 700;
    }
    .tpl-${id} .q-mark { color: ${c.accentOnWash}; font-weight: 800; }
    /* The answer is a real card so the reply reads as separate from the question. */
    .tpl-${id} .answer {
      background: ${c.surface}; border: 1px solid ${c.hairline};
      border-left: 6px solid ${c.accent}; border-radius: 16px;
      padding: 32px 34px; display: flex; flex-direction: column; gap: 16px;
    }
    .tpl-${id} .answer-label {
      font-family: ${ctx.fonts.utility}; font-size: 18px; font-weight: 700;
      letter-spacing: .16em; text-transform: uppercase; color: ${c.muted};
    }
    .tpl-${id} .answer-text { font-size: 31px; line-height: 1.4; color: ${c.ink}; font-weight: 400; }
    .tpl-${id} .ans-points { list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .tpl-${id} .ans-points li { font-size: 26px; line-height: 1.3; color: ${c.ink}; padding-left: 26px; position: relative; }
    .tpl-${id} .ans-points li::before { content: ""; position: absolute; left: 0; top: 14px; width: 12px; height: 12px; border-radius: 3px; background: ${c.accent}; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; align-self: flex-start; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 18px; }
    .tpl-${id} .foot-row { display: flex; align-items: center; gap: 18px; }
    .tpl-${id} .footer { font-size: 20px; }
    .tpl-${id} .brandname { font-size: 21px; }
  `;

  return { html, css };
}

export default { id, label, render };
