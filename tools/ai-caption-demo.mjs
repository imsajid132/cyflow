/**
 * Dev demo: write per-platform captions by LOOKING at a rendered poster.
 *   AI_API_KEY=... node tools/ai-caption-demo.mjs path/to/poster.png
 */
import { readFileSync } from 'node:fs';
import { generateCaptionsFromImage } from '../src/services/aiStudio/captionService.js';

const png = readFileSync(process.argv[2]);
console.log('Reading the poster and writing captions with Claude vision ...\n');

const caps = await generateCaptionsFromImage({
  pngBuffer: png,
  brand: { businessName: 'Lahore Fitness Club', industry: 'Gym & personal training', tone: 'bold, energetic, motivating' },
  content: {
    headline: 'Stronger Every Single Day',
    subtext: 'Personal training, group classes, and 24/7 access in the heart of Lahore.',
    cta: 'Start your free trial',
  },
});

console.log('================= FACEBOOK =================\n' + caps.facebook);
console.log('\n================= INSTAGRAM =================\n' + caps.instagram);
console.log('\n================= THREADS ==================\n' + caps.threads);
