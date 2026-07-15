/**
 * The shared stylesheet every layout composes from.
 *
 * This is the "design system" half of the templates: canvas reset, type roles,
 * the CTA, the footer lockup, dividers, and the geometric shape primitives.
 * Layout modules add only the structure that makes them distinct, which keeps
 * the templates recognisably one family.
 *
 * Every rule is scoped to the template's own class. Each render is a standalone
 * document, but scoping means two templates' stylesheets can be concatenated
 * (a preview contact sheet, a future picker) without one palette overriding
 * another.
 *
 * Everything is built from validated palette/font values. No url() is ever
 * emitted, so a rendered image can never fetch a remote asset — the business's
 * own https logo is the single exception and it is an <img>, not CSS.
 */

/**
 * @param {{ width:number, height:number, palette:object, fonts:object, type:object, scope:string }} ctx
 */
export function baseCss({ width, height, palette: c, fonts, type, scope }) {
  const s = scope;
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; }
    body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

    ${s} {
      position: relative; width: ${width}px; height: ${height}px; overflow: hidden;
      background: ${c.wash}; color: ${c.ink}; font-family: ${fonts.body};
    }
    ${s} .layer { position: absolute; inset: 0; z-index: 1; }
    ${s} .content { position: relative; z-index: 3; width: 100%; height: 100%; display: flex; flex-direction: column; }

    /* --- type roles ------------------------------------------------------ */
    /* Brand-coloured text on the canvas uses the wash-readable shade: the raw
       brand can be invisible against a dark canvas. */
    ${s} .eyebrow {
      font-family: ${fonts.utility}; font-size: 22px; font-weight: 700;
      letter-spacing: .22em; text-transform: uppercase; color: ${c.brandOnWash};
    }
    ${s} .headline {
      font-family: ${fonts.display}; font-size: ${type.headline.size}px;
      line-height: ${type.headline.leading}; letter-spacing: ${type.headline.tracking};
      font-weight: 700; color: ${c.ink}; text-wrap: balance;
    }
    ${s} .subheadline {
      font-size: ${type.sub.size}px; line-height: ${type.sub.leading};
      color: ${c.muted}; font-weight: 400; max-width: 30ch;
    }
    ${s} .brandname {
      font-family: ${fonts.utility}; font-size: 26px; font-weight: 700;
      letter-spacing: .04em; color: ${c.ink};
    }

    /* --- logo ------------------------------------------------------------ */
    ${s} .logo { height: 72px; max-width: 260px; object-fit: contain; object-position: left center; display: block; }
    ${s} .logo-right { object-position: right center; }

    /* --- CTA ------------------------------------------------------------- */
    /* flex-shrink:0 + nowrap: in a row beside the footer lockup the CTA must
       keep its shape and let the footer wrap instead. */
    ${s} .cta {
      display: inline-flex; align-items: center; align-self: flex-start;
      flex: 0 0 auto; white-space: nowrap;
      padding: 22px 42px; border-radius: 999px;
      background: ${c.accent}; color: ${c.onAccent};
      font-family: ${fonts.utility}; font-size: 28px; font-weight: 700; letter-spacing: .01em;
    }
    ${s} .cta-outline { background: transparent; color: ${c.ink}; border: 2px solid ${c.ink}; padding: 20px 40px; }
    ${s} .cta-brand { background: ${c.brand}; color: ${c.onBrand}; }

    /* --- structure ------------------------------------------------------- */
    ${s} .rule { height: 4px; width: 88px; border-radius: 4px; background: ${c.accent}; }
    ${s} .hairline { height: 1px; width: 100%; background: ${c.hairline}; }
    ${s} .tag {
      display: inline-flex; align-items: center; padding: 10px 22px; border-radius: 999px;
      background: ${c.brandSoft}; color: ${c.brandDeep};
      font-family: ${fonts.utility}; font-size: 20px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
    }
    ${s} .footer {
      display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
      font-family: ${fonts.utility}; font-size: 22px; font-weight: 600; color: ${c.muted};
    }
    ${s} .footer-dot { width: 5px; height: 5px; border-radius: 50%; background: ${c.accent}; flex: 0 0 5px; }
    ${s} .spacer { flex: 1 1 auto; }

    /* --- geometric primitives (no photos are ever invented) -------------- */
    ${s} .shape { position: absolute; }
    ${s} .shape-disc { border-radius: 50%; }
    ${s} .shape-arc { border-radius: 50%; border-style: solid; background: transparent; }
    ${s} .shape-bar { border-radius: 999px; }
  `;
}

export default { baseCss };
