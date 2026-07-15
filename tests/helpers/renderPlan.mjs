/**
 * Render a controlled 7-day plan to real 1080x1080 cards + a contact sheet.
 *
 * This is a REVIEW tool, not a test. Reading the CSS is not review: layout bugs
 * in this system have repeatedly been invisible in code and obvious in a render.
 *
 * Two properties make the output trustworthy:
 *
 *   It goes through the PRODUCTION sanitization path (`sanitizeForTest`, the
 *   same function socialImageService feeds HCTI), so anything the allow-list
 *   strips is stripped here too.
 *
 *   Each card is rendered in its OWN document, via an iframe srcdoc. Layout CSS
 *   is scoped per template but the base stylesheet is not, so two cards sharing
 *   one document overwrite each other and the sheet would lie.
 *
 * Usage:
 *   node tests/helpers/renderPlan.mjs [outDir]
 *   then, for each dayN-*.html, screenshot it at a TRUE 1080x1080 viewport:
 *     chrome --headless=new --window-size=1080,1080 \
 *            --screenshot=<outDir>\dayN-<template>.png <outDir>/dayN-<template>.html
 *   then screenshot contact-sheet.html, which composes those PNGs.
 */

// Must precede any import that reaches src/config/env.js, which validates
// process.env at import time.
import './setupEnv.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildTemplate } from '../../src/templates/socialImageTemplates.js';
import { sanitizeForTest } from '../../src/services/socialImageService.js';
import { PLAN } from './samplePlan.mjs';

const OUT = process.argv[2] || join(process.cwd(), '.render-review');

/** The business profile as it would be saved, with the exact brand palette. */
export const CYFROW = Object.freeze({
  brandName: 'Cyfrow Solutions',
  businessCategory: 'IT and web services',
  primaryColor: '#111827',
  secondaryColor: '#23A455',
  accentColor: '#FDC70F',
  website: 'cyfrowsolutions.com',
  headingFont: null,
  bodyFont: null,
  logoUrl: '',
});

export function renderCard(post) {
  const built = buildTemplate({
    template: post.templateKey,
    aspectRatio: 'square',
    backgroundStyle: 'light',
    brandName: CYFROW.brandName,
    businessCategory: CYFROW.businessCategory,
    primaryColor: CYFROW.primaryColor,
    secondaryColor: CYFROW.secondaryColor,
    accentColor: CYFROW.accentColor,
    headingFont: CYFROW.headingFont,
    bodyFont: CYFROW.bodyFont,
    logoUrl: CYFROW.logoUrl,
    website: CYFROW.website,
    headline: post.headline,
    subheadline: post.subheadline,
    cta: post.cta,
    serviceTag: post.serviceTag,
    bullets: post.bullets,
    stat: post.stat,
    comparison: post.comparison,
    badge: post.badge,
    locationLabel: post.locationLabel,
  });

  // The renderer receives SANITIZED html. Previewing raw buildTemplate output
  // would hide exactly the class of bug this exists to catch.
  const safeHtml = sanitizeForTest(built.html);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;}
    ${built.css}
  </style></head><body>${safeHtml}</body></html>`;
  return { doc, built, safeHtml };
}

/**
 * The contact sheet is built from real 1080 SCREENSHOTS, not from live iframes.
 *
 * An earlier version embedded each card as an iframe scaled with a CSS
 * transform. It lied: at 0.5 scale the 1px grid lines aliased into coarse
 * stripes, so a field treatment that is correct at 1080 looked like a rendering
 * fault, and a defect could just as easily have been hidden the same way. An
 * <img> is downscaled by the image pipeline with proper filtering, so what you
 * review is what HCTI would produce.
 *
 * Run screenshots first (see the header of this file), then this sheet.
 */
function contactSheet(cards) {
  const cells = cards
    .map(
      (c, i) => `
    <figure class="cell">
      <figcaption><b>Day ${i + 1}</b> · ${c.post.templateKey} · ${c.post.format}</figcaption>
      <img src="./day${i + 1}-${c.post.templateKey}.png" alt="Day ${i + 1}">
    </figure>`,
    )
    .join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#5b5f66;font:13px -apple-system,Segoe UI,Roboto,sans-serif;padding:22px;}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;}
    .cell{margin:0;}
    figcaption{color:#fff;padding:5px 2px;font-size:12px;}
    img{width:100%;display:block;border-radius:3px;background:#fff;}
  </style></head><body>
  <div class="grid">${cells}</div>
  </body></html>`;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const cards = PLAN.map((post) => ({ post, ...renderCard(post) }));

  cards.forEach((c, i) => {
    writeFileSync(join(OUT, `day${i + 1}-${c.post.templateKey}.html`), c.doc, 'utf8');
  });
  writeFileSync(join(OUT, 'contact-sheet.html'), contactSheet(cards), 'utf8');

  for (const c of cards) {
    const stripped = [];
    if (c.post.bullets?.length && !/<li/.test(c.safeHtml)) stripped.push('bullets missing from rendered html');
    if (c.post.comparison && !/col-item|col-list/.test(c.safeHtml)) stripped.push('comparison columns missing');
    if (c.post.badge && !c.safeHtml.includes(c.post.badge)) stripped.push('badge missing');
    console.log(
      `day ${String(PLAN.indexOf(c.post) + 1).padStart(2)} ${c.post.templateKey.padEnd(18)} ` +
        `${String(c.safeHtml.length).padStart(5)}B ${stripped.length ? `!! ${stripped.join('; ')}` : 'ok'}`,
    );
  }
  console.log(`\ncontact sheet: ${join(OUT, 'contact-sheet.html')}`);
}

main();
