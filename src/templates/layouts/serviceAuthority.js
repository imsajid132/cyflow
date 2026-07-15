/**
 * Service Authority.
 *
 * For a service-specific insight or a soft promotional post. A split card: the
 * service is named in a brand panel on the left, the insight sits on a light
 * field on the right. The CTA appears only when one was supplied.
 */

import { logo, cta, subheadline, footerLockup } from '../parts.js';

export const id = 'service-authority';
export const label = 'Service Authority';

export function render(ctx) {
  const { text, logoUrl, palette: c } = ctx;

  const html = `
    <div class="canvas tpl-${id}">
      <div class="content split">
        <aside class="panel">
          ${logo(logoUrl, { className: 'panel-logo' })}
          <div class="panel-foot">
            ${text.badge ? `<span class="panel-label">${text.badge}</span>` : ''}
            ${text.tag ? `<span class="panel-service">${text.tag}</span>` : ''}
          </div>
        </aside>
        <section class="main">
          <div class="body">
            <h1 class="headline">${text.headline}</h1>
            <div class="divider"></div>
            ${subheadline(text.sub)}
            ${cta(text.cta)}
          </div>
          <footer class="foot">
            <div class="hairline"></div>
            ${footerLockup(text)}
          </footer>
        </section>
      </div>
    </div>`;

  const css = `
    .tpl-${id} { background: ${c.wash}; }
    .tpl-${id} .split { flex-direction: row; }
    /* The panel names the service at size. It was mostly empty when the service
       label sat alone at the bottom, so the label block is centred and the
       service is set large enough to be the panel's subject. */
    .tpl-${id} .panel {
      position: relative; width: 38%; flex: 0 0 38%;
      background: linear-gradient(190deg, ${c.brand} 0%, ${c.brandDeep} 100%);
      display: flex; flex-direction: column; gap: 40px;
      padding: 64px 44px; border-right: 10px solid ${c.accent};
    }
    .tpl-${id} .panel-logo { height: 54px; max-width: 170px; flex: 0 0 auto; }
    .tpl-${id} .panel-foot { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
    .tpl-${id} .panel-label {
      font-family: ${ctx.fonts.utility}; font-size: 18px; font-weight: 700;
      letter-spacing: .16em; text-transform: uppercase; color: ${c.accent};
    }
    .tpl-${id} .panel-service {
      font-family: ${ctx.fonts.display}; font-size: 42px; font-weight: 700;
      line-height: 1.12; color: ${c.onBrand};
    }
    /* A rule under the service so the panel has a base, not a floating label. */
    .tpl-${id} .panel-foot::after {
      content: ""; width: 72px; height: 5px; border-radius: 5px; background: ${c.accent}; margin-top: 6px;
    }
    .tpl-${id} .main { flex: 1; display: flex; flex-direction: column; padding: 88px 72px 76px; gap: 28px; }
    .tpl-${id} .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 24px; align-items: flex-start; }
    .tpl-${id} .headline {
      color: ${c.ink}; font-size: ${Math.round(ctx.type.headline.size * 0.72)}px;
      max-width: 14ch; font-weight: 700;
    }
    .tpl-${id} .headline .em { color: ${c.accentOnWash}; }
    .tpl-${id} .divider { width: 84px; height: 5px; border-radius: 5px; background: ${c.accent}; }
    .tpl-${id} .subheadline { color: ${c.muted}; max-width: 24ch; font-size: 27px; }
    .tpl-${id} .cta { background: ${c.accent}; color: ${c.onAccent}; font-size: 23px; padding: 15px 30px; }
    .tpl-${id} .foot { display: flex; flex-direction: column; gap: 16px; }
    .tpl-${id} .footer { font-size: 19px; }
    .tpl-${id} .brandname { font-size: 20px; }
  `;

  return { html, css };
}

export default { id, label, render };
