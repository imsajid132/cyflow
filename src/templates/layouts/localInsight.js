/**
 * Local Insight.
 *
 * For a location-specific angle. The place name is set as a quiet label above
 * the headline rather than as a claim — nothing here asserts a local statistic
 * or a market position, because nothing verifies one.
 */

import { logo, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'local-insight';
export const label = 'Local Insight';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="layer"><div class="band"></div></div>
      <div class="grid-field grid-field-on-brand"></div>
      <div class="content">
        <header class="head">
          ${logo(logoUrl)}
          <span class="spacer"></span>
          ${text.badge ? `<span class="badge-pill">${text.badge}</span>` : ''}
        </header>
        <div class="card">
          ${text.locationLabel ? `<span class="place">${text.locationLabel}</span>` : ''}
          <h1 class="headline">${text.headline}</h1>
          <div class="divider"></div>
          ${subheadline(text.sub)}
          ${cta(text.cta)}
        </div>
        <footer class="foot">
          ${footerLockup(text)}
        </footer>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.brand}; }
    /* The brand field is the ground; the content sits on a raised card. */
    .tpl-${id} .band { position: absolute; inset: 0; background: linear-gradient(175deg, ${c.brand} 0%, ${c.brandDeep} 100%); }
    .tpl-${id} .content { padding: 72px 68px 64px; gap: 26px; }
    .tpl-${id} .head { display: flex; align-items: center; gap: 20px; min-height: 56px; }
    .tpl-${id} .logo { height: 52px; max-width: 200px; }
    .tpl-${id} .badge-pill {
      display: inline-flex; align-items: center; padding: 9px 20px; border-radius: 999px;
      border: 1.5px solid ${c.accent}; color: ${c.accent};
      font-family: ${ctx.fonts.utility}; font-size: 19px; font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
    }
    /* Bottom-weighted inside the card, so the place label leads the eye down
       into the headline rather than sitting in a centred island. */
    .tpl-${id} .card {
      flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start;
      gap: 22px; background: ${c.surface}; border-radius: 26px; padding: 62px 56px;
      border-top: 10px solid ${c.accent};
    }
    .tpl-${id} .place {
      font-family: ${ctx.fonts.utility}; font-size: 21px; font-weight: 800;
      letter-spacing: .16em; text-transform: uppercase; color: ${c.accentOnWash};
    }
    .tpl-${id} .headline {
      color: ${c.ink}; font-size: ${Math.round(ctx.type.headline.size * 0.72)}px;
      max-width: 19ch; font-weight: 700;
    }
    .tpl-${id} .divider { width: 84px; height: 5px; border-radius: 5px; background: ${c.support}; }
    .tpl-${id} .subheadline { color: ${c.muted}; max-width: 28ch; font-size: 27px; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; }
    .tpl-${id} .foot { display: flex; align-items: center; }
    .tpl-${id} .footer { color: ${c.onBrand}; opacity: .8; font-size: 20px; }
    .tpl-${id} .brandname { color: ${c.onBrand}; font-size: 21px; }
    .tpl-${id} .footer-dot { background: ${c.accent}; opacity: 1; }
  `;

  return { html, css };
}

export default { id, label, render };
