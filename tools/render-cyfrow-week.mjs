/**
 * The controlled Cyfrow Solutions week: seven creatives at a TRUE 1080x1080,
 * through the production template builder and the production sanitizer.
 *
 * Chapter 11's test. The plan is the hand-authored Balanced week in
 * tests/helpers/samplePlan.mjs, so the same cards render every time and the
 * verdict does not depend on a model's mood or an API key.
 *
 * Individual PNGs first, then a contact sheet composed FROM those PNGs. The
 * sheet is never CSS-scaled iframes: scaling aliases hairlines and either
 * invents defects or hides them.
 *
 * Usage: node tools/render-cyfrow-week.mjs [outDir]
 */

import './setup-env.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildTemplate } from '../src/templates/socialImageTemplates.js';
import { sanitizeForTest } from '../src/services/socialImageService.js';
import { buildPalette } from '../src/templates/brandKit.js';
import { PLAN } from '../tests/helpers/samplePlan.mjs';
import { launch } from './cdp.mjs';

const OUT = process.argv[2] || '.render-review/phase-4.8/social-creatives';

/** The customer's saved brand. Never Cyflow's green. */
const CYFROW = Object.freeze({
  brandName: 'Cyfrow Solutions',
  businessCategory: 'SEO agency',
  website: 'cyfrowsolutions.com',
  primaryColor: '#111827',
  secondaryColor: '#23A455',
  accentColor: '#FDC70F',
  headingFont: 'Helvetica Neue',
  bodyFont: 'Helvetica Neue',
  // Website enabled, phone disabled, per the brief.
  phone: null,
});

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function buildCard(post) {
  return buildTemplate({
    ...CYFROW,
    template: post.templateKey,
    aspectRatio: 'square',
    backgroundStyle: 'light',
    headline: post.headline,
    subheadline: post.subheadline,
    cta: post.cta,
    serviceTag: post.serviceTag,
    badge: post.badge,
    bullets: post.bullets,
    comparison: post.comparison,
    answerSummary: post.answerSummary,
    locationLabel: post.localLabel,
    // No stat is supplied anywhere: the business gave us no verified figure, so
    // no card may claim one.
    stat: null,
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const palette = buildPalette({ ...CYFROW, backgroundStyle: 'light' });
  const cards = PLAN.map((post, i) => {
    const built = buildCard(post);
    const safeHtml = sanitizeForTest(built.html);
    const name = DAY_NAMES[i];
    const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}${built.css}</style></head><body>${safeHtml}</body></html>`;
    writeFileSync(join(OUT, `${name}.html`), doc, 'utf8');
    return { post, name, built, safeHtml };
  });

  // --- deterministic checks, before anyone looks -----------------------------
  const findings = [];
  const hexOf = (css) => [...new Set((css.match(/#[0-9a-f]{6}/gi) || []).map((h) => h.toLowerCase()))];
  const FORBIDDEN = ['#1f3a8a', '#e0653a', '#6366f1', '#4f46e5', '#8b5cf6', '#ec4899', '#0ea5e9'];

  for (const { post, name, built, safeHtml } of cards) {
    const css = built.css.toLowerCase();
    if (!css.includes('#111827')) findings.push(`${name}: lost the brand colour`);
    if (!css.includes('#fdc70f')) findings.push(`${name}: lost the accent colour`);
    for (const hex of FORBIDDEN) if (css.includes(hex)) findings.push(`${name}: unrelated colour ${hex}`);
    // Cyflow's own green must never enter a customer creative.
    for (const hex of ['#1f9e5b', '#1a844c']) {
      if (css.includes(hex)) findings.push(`${name}: CYFLOW APP GREEN leaked into a customer post`);
    }
    if (/cyflow-mark|\/assets\/brand\//.test(safeHtml)) findings.push(`${name}: Cyflow app asset in a customer post`);
    if (post.bullets?.length && !/<li/.test(safeHtml)) findings.push(`${name}: bullets dropped by the sanitizer`);
    if (post.comparison && !/col-item/.test(safeHtml)) findings.push(`${name}: comparison columns dropped`);
    if (/\d+%/.test(safeHtml)) findings.push(`${name}: a percentage appears on a card with no verified figure`);
    if (/[—–]/.test(safeHtml)) findings.push(`${name}: a forbidden dash reached the card`);
    if (!/url\s*\(/.test(built.css) === false) findings.push(`${name}: css emits a url()`);
  }

  const families = new Set(PLAN.map((p) => p.visualFamily));
  const layouts = new Set(PLAN.map((p) => p.templateKey));
  if (layouts.size < 5) findings.push(`only ${layouts.size} visual families across the week`);
  for (let i = 1; i < PLAN.length; i += 1) {
    if (PLAN[i].templateKey === PLAN[i - 1].templateKey) findings.push(`days ${i} and ${i + 1} repeat a layout`);
  }

  // --- true 1080 screenshots, then a sheet from the PNGs ---------------------
  const browser = await launch({ width: 1080, height: 1080, port: 9500 });
  try {
    await browser.setViewport(1080, 1080);
    for (const { name } of cards) {
      // eslint-disable-next-line no-await-in-loop
      await browser.goto(`file:///${join(process.cwd(), OUT, `${name}.html`).replace(/\\/g, '/')}`, { waitMs: 700 });
      // eslint-disable-next-line no-await-in-loop
      await browser.screenshot(join(OUT, `${name}.png`));
    }

    const sheet = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#5b5f66;font:12px system-ui;padding:20px;}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
      figure{margin:0;} figcaption{color:#fff;padding:4px 2px;}
      img{width:100%;display:block;border-radius:3px;background:#fff;}
      b{color:#fff}
    </style><div class="grid">${cards.map(({ post, name }) => `
      <figure>
        <figcaption><b>${name}</b> &middot; ${post.pillar} &middot; ${post.templateKey}</figcaption>
        <img src="./${name}.png" alt="${name}">
      </figure>`).join('')}</div>`;
    writeFileSync(join(OUT, 'contact-sheet.html'), sheet, 'utf8');

    await browser.setViewport(1500, 900);
    await browser.goto(`file:///${join(process.cwd(), OUT, 'contact-sheet.html').replace(/\\/g, '/')}`, { waitMs: 1200 });
    await browser.screenshot(join(OUT, 'contact-sheet.png'));
  } finally {
    await browser.close();
  }

  // --- the report ------------------------------------------------------------
  const report = [
    '# Cyfrow Solutions — controlled seven-day creative review',
    '',
    '**Business:** Cyfrow Solutions (an SEO agency). **Timezone:** Asia/Karachi.',
    '**Platforms:** Instagram Professional and Threads only. Facebook is not included.',
    '**Rhythm:** Balanced Weekly Rhythm. One post per day.',
    '',
    '## Palette (the CUSTOMER\'s, traced to the render)',
    '',
    `- \`palette.source\`: **${palette.source}**`,
    `- \`palette.adjusted\`: **${JSON.stringify(palette.adjusted)}**`,
    `- resolved roles: brand \`${palette.brand}\`, accent \`${palette.accent}\`, support \`${palette.support}\``,
    '',
    '## Cards',
    '',
    '| Day | Pillar | Format | Visual family | Layout |',
    '| --- | --- | --- | --- | --- |',
    ...PLAN.map((p, i) => `| ${DAY_NAMES[i]} | ${p.pillar} | ${p.format} | ${p.visualFamily} | ${p.templateKey} |`),
    '',
    `Distinct layouts across the week: **${layouts.size}** (${[...layouts].join(', ')})`,
    `Distinct named families: **${families.size}**`,
    '',
    '## Every hex reaching the CSS',
    '',
    ...cards.map(({ name, built }) => `- **${name}**: ${hexOf(built.css).join(' ')}`),
    '',
    '## Deterministic findings',
    '',
    findings.length ? findings.map((f) => `- ${f}`).join('\n') : '_None._',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'quality-report.md'), `${report}\n`);

  // eslint-disable-next-line no-console
  console.log(report);
  // eslint-disable-next-line no-console
  console.log(`\nlayouts: ${layouts.size} | findings: ${findings.length} | ${OUT}/contact-sheet.png`);
}

await main();
