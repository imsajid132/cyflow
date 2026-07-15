/**
 * Editorial Insight — the planner's default authority layout.
 *
 * A full-bleed brand field with a large editorial headline, a small category
 * badge, and a minimal footer lockup. When the business's brand canvas is dark
 * (the common case: a near-black primary plus a bright accent) the whole card
 * becomes that colour, which is what makes it read as *their* post rather than
 * a template with their logo dropped on it.
 *
 * No decorative blobs: the only non-text elements are a restrained brand
 * gradient and a hairline rule, both of which do compositional work.
 */

import { logo, cta, subheadline, footerLockup, eyebrowRule } from '../parts.js';

export const id = 'editorial-insight';
export const label = 'Editorial Insight';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer">
        <div class="field"></div>
        <div class="accent-edge"></div>
      </div>
      <div class="grid-field${c.canvasIsDark ? ' grid-field-on-brand' : ''}"></div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
        </header>
        <div class="body">
          ${eyebrowRule('', c.canvasIsDark ? 'eyebrow-lockup-on-brand' : '')}
          <h1 class="headline">${text.headline}</h1>
          ${subheadline(text.sub)}
        </div>
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

  // A dark saved canvas becomes the field; a light one keeps a light card with
  // the brand as its accent. Either way the saved colour is used as given.
  const onField = c.canvasIsDark ? c.onBrand : c.ink;
  const fieldBg = c.canvasIsDark
    ? `linear-gradient(160deg, ${c.brand} 0%, ${c.brandDeep} 100%)`
    : c.wash;

  const css = `
    .tpl-${id} { background: ${fieldBg}; }
    .tpl-${id} .field { position: absolute; inset: 0; background: ${fieldBg}; }
    /* One accent edge, doing the job a decorative shape would only pretend to:
       it anchors the composition and states the brand colour. */
    .tpl-${id} .accent-edge {
      position: absolute; left: 0; right: 0; bottom: 0; height: 12px;
      background: ${c.accent};
    }
    .tpl-${id} .content { padding: 92px 88px 80px; gap: 28px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 60px; flex: 0 0 auto; }
    .tpl-${id} .logo { height: 54px; max-width: 210px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 10px 22px; border-radius: 999px;
      border: 1.5px solid ${c.accent}; color: ${c.accent};
      font-family: ${ctx.fonts.utility}; font-size: 20px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
    }
    /* Bottom-weighted, not centred: a centred block on a 1080 square leaves a
       void above and below that reads as unfinished. */
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 24px; padding-bottom: 40px; }
    .tpl-${id} .headline { color: ${onField}; max-width: 19ch; font-weight: 700; }
    /* One emphasis word in the accent, not the whole line. */
    .tpl-${id} .headline .em { color: ${c.accent}; }
    .tpl-${id} .subheadline { color: ${onField}; opacity: .74; max-width: 30ch; font-size: 30px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 22px; }
    .tpl-${id} .foot-row { display: flex; align-items: center; gap: 18px; }
    .tpl-${id} .hairline { background: ${onField}; opacity: .18; }
    .tpl-${id} .footer { color: ${onField}; opacity: .72; font-size: 21px; }
    .tpl-${id} .brandname { color: ${onField}; font-size: 22px; }
    .tpl-${id} .footer-dot { background: ${c.accent}; opacity: 1; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 24px; padding: 16px 32px; }
  `;

  return { html, css };
}

export default { id, label, render };
