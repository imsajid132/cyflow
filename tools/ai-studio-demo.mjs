/**
 * Dev demo: generate the 3-style poster set with the in-repo aiStudio service.
 *   AI_API_KEY=... node tools/ai-studio-demo.mjs [outDir]
 * Writes poster-<style>.png for each style. No paid service (free local Chrome).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generatePosters } from '../src/services/aiStudio/aiPosterService.js';

const OUT = process.argv[2] || '.';
mkdirSync(OUT, { recursive: true });

const input = {
  brand: { businessName: 'Lahore Fitness Club', industry: 'Gym & personal training', tone: 'bold, energetic, motivating' },
  colors: { primary: '#0B0B0B', secondary: '#1A1A1A', accent: '#C6FF00' },
  font: 'Montserrat',
  content: {
    headline: 'Stronger Every Single Day',
    subtext: 'Personal training, group classes, and 24/7 access in the heart of Lahore.',
    cta: 'Start your free trial',
  },
  images: [],
};

console.log('Generating 3 styles with Claude ...');
const t0 = Date.now();
const posters = await generatePosters(input);
console.log(`Got ${posters.length} posters in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

for (const p of posters) {
  const file = join(OUT, `poster-${p.id}.png`);
  writeFileSync(file, p.png);
  console.log(`  ${p.label.padEnd(20)} -> ${file}  (${p.png.length} bytes)`);
}
if (!posters.length) { console.error('No posters produced.'); process.exit(1); }
