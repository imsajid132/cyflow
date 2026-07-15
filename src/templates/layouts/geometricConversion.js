/**
 * Geometric Conversion Post.
 *
 * Built around the CTA rather than the headline: layered arcs sweep up from the
 * bottom-right and terminate at the button, and an accent bar pins the top-left
 * so the diagonal has an anchor. Everything else is deliberately quiet.
 */

import { logo, eyebrow, cta, tag, subheadline, footerLockup } from '../parts.js';

export const id = 'geometric-conversion';
export const label = 'Geometric Conversion Post';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="shape shape-arc sweep-a"></div>
        <div class="shape shape-arc sweep-b"></div>
        <div class="shape shape-disc pip"></div>
        <div class="shape shape-bar accent-bar"></div>
      </div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${tag(text.tag)}
        </header>
        <div class="body">
          ${eyebrow(text.eyebrow)}
          <h1 class="headline">${text.headline}</h1>
          ${subheadline(text.sub)}
          ${cta(text.cta)}
        </div>
        <footer class="foot">
          ${footerLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .sweep-a {
      width: 760px; height: 760px; right: -240px; bottom: -280px;
      border-width: 90px; border-color: ${c.brand}; opacity: .16;
    }
    .tpl-${id} .sweep-b {
      width: 520px; height: 520px; right: -120px; bottom: -180px;
      border-width: 54px; border-color: ${c.accent}; opacity: .28;
    }
    .tpl-${id} .pip { width: 40px; height: 40px; right: 300px; bottom: 330px; background: ${c.support}; opacity: .8; }
    /* Sits in the outer margin so it can never collide with the logo. */
    .tpl-${id} .accent-bar { left: 0; top: 92px; width: 56px; height: 10px; background: ${c.accent}; border-radius: 0 10px 10px 0; }
    /* The gap guarantees clearance between the logo row and the eyebrow even
       when a long headline pushes the centred body block upward. */
    .tpl-${id} .content { padding: 92px; gap: 44px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 24px; min-height: 72px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
    .tpl-${id} .headline { max-width: 15ch; }
    .tpl-${id} .subheadline { max-width: 26ch; }
    .tpl-${id} .cta { margin-top: 12px; box-shadow: 0 16px 38px ${c.accent}4d; }
    .tpl-${id} .foot { display: flex; align-items: flex-end; }
  `;

  return { html, css };
}

export default { id, label, render };
