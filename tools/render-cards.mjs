/**
 * Render arbitrary cards to true-1080 review HTML through the PRODUCTION path.
 *
 * A build/review tool. Takes card specs, runs them through buildTemplate +
 * sanitizeForTest (the same string HCTI receives), and writes one standalone
 * document per card so headless Chrome can screenshot each at a real 1080x1080.
 * Never CSS-scales as final evidence.
 *
 * Usage: node tools/render-cards.mjs <outDir> <specsJsonFile>
 */

import './setup-env.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildTemplate } from '../src/templates/socialImageTemplates.js';
import { sanitizeForTest } from '../src/services/socialImageService.js';

const outDir = process.argv[2] || '.render-review/cards';
const specsFile = process.argv[3];
const specs = JSON.parse(readFileSync(specsFile, 'utf8'));

mkdirSync(outDir, { recursive: true });
for (const spec of specs) {
  const built = buildTemplate({ aspectRatio: 'square', backgroundStyle: 'light', ...spec });
  const safeHtml = sanitizeForTest(built.html);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}${built.css}</style></head><body>${safeHtml}</body></html>`;
  const name = spec._name || spec.template;
  writeFileSync(join(outDir, `${name}.html`), doc, 'utf8');
  const checks = [];
  if (spec.bullets?.length && !/<li/.test(safeHtml)) checks.push('BULLETS DROPPED');
  if (spec.comparison && !/col-item/.test(safeHtml)) checks.push('COLUMNS DROPPED');
  console.log(`${name.padEnd(22)} ${String(safeHtml.length).padStart(5)}B ${checks.length ? `!! ${checks.join(', ')}` : 'ok'}`);
}
console.log(`\nwrote ${specs.length} cards to ${outDir}`);
