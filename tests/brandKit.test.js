// Phase 4.6: the design system that normalizes arbitrary brand input.
import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPalette,
  fontCategory,
  fontStack,
  headlineScale,
  subheadlineScale,
  clampText,
  eyebrowFrom,
  contrastRatio,
  hexToHsl,
  hslToHex,
  safeColor,
  safeImageUrl,
  escapeHtml,
} from '../src/templates/brandKit.js';

const HEX = /^#[0-9a-f]{6}$/;

function assertAllHex(palette) {
  for (const [key, value] of Object.entries(palette)) {
    if (typeof value !== 'string') continue;
    assert.match(value, HEX, `palette.${key} must be a plain hex colour, got ${value}`);
  }
}

test('hsl round-trips within rounding tolerance', () => {
  for (const hex of ['#123456', '#ff0088', '#00ff00', '#ffffff', '#000000', '#7f7f7f']) {
    const { h, s, l } = hexToHsl(hex);
    const back = hslToHex(h, s, l);
    assert.match(back, HEX);
    // Allow 1/255 per channel of rounding drift.
    for (let i = 1; i < 7; i += 2) {
      const a = parseInt(hex.slice(i, i + 2), 16);
      const b = parseInt(back.slice(i, i + 2), 16);
      assert.ok(Math.abs(a - b) <= 1, `${hex} -> ${back} drifted on channel ${i}`);
    }
  }
});

test('a palette is always complete, hex-only, and readable', () => {
  const inputs = [
    {},
    { primaryColor: '#123456', secondaryColor: '#64748b', accentColor: '#ff0088' },
    { primaryColor: '#00ff00', secondaryColor: '#ff00ff', accentColor: '#ffff00' },
    { primaryColor: '#000000' },
    { primaryColor: '#ffffff' },
    { primaryColor: 'not-a-colour', accentColor: 'javascript:alert(1)' },
  ];
  for (const input of inputs) {
    for (const backgroundStyle of ['light', 'dark']) {
      const p = buildPalette({ ...input, backgroundStyle });
      assertAllHex(p);
      // Body text must stay legible against the surfaces it sits on.
      assert.ok(contrastRatio(p.ink, p.wash) >= 4.5, `ink/wash contrast for ${JSON.stringify(input)}`);
      assert.ok(contrastRatio(p.ink, p.surface) >= 4.5, `ink/surface contrast for ${JSON.stringify(input)}`);
      // Text placed on filled brand/accent areas must be legible too.
      assert.ok(contrastRatio(p.onBrand, p.brand) >= 4.5, `onBrand contrast for ${JSON.stringify(input)}`);
      assert.ok(contrastRatio(p.onAccent, p.accent) >= 4.5, `onAccent contrast for ${JSON.stringify(input)}`);
    }
  }
});

test('a loud brand colour is normalized into a usable band', () => {
  const p = buildPalette({ primaryColor: '#00ff00' });
  const brand = hexToHsl(p.brand);
  // Hue is preserved — it is still recognisably their green.
  assert.ok(Math.abs(brand.h - 120) < 2);
  // ...but the raw neon is pulled into the band the templates can fill with.
  assert.ok(brand.s <= 82, `saturation ${brand.s} should be clamped`);
  assert.ok(brand.l >= 32 && brand.l <= 56, `lightness ${brand.l} should be clamped`);
  assert.notEqual(p.brand, '#00ff00');
});

test('an achromatic brand never has a hue invented for it', () => {
  // A white/grey brand has no hue; forcing saturation would turn it brown.
  for (const primaryColor of ['#ffffff', '#fafafa', '#808080', '#000000']) {
    const p = buildPalette({ primaryColor });
    const brand = hexToHsl(p.brand);
    assert.ok(brand.s <= 10, `${primaryColor} -> brand saturation ${brand.s} must stay near-grey`);
    const wash = hexToHsl(p.wash);
    assert.equal(wash.s, 0, `${primaryColor} -> wash must be a true grey`);
    // It still darkens into a usable charcoal rather than staying invisible.
    assert.ok(brand.l <= 36, `${primaryColor} -> brand lightness ${brand.l}`);
  }
});

test('neutrals are tinted with the brand hue so the set reads as one system', () => {
  const p = buildPalette({ primaryColor: '#1f6feb' });
  const hue = hexToHsl(p.brand).h;
  for (const key of ['wash', 'surface', 'ink', 'muted', 'hairline']) {
    const c = hexToHsl(p[key]);
    assert.ok(c.s > 0, `${key} should carry a trace of the brand hue, not be flat grey`);
    assert.ok(c.s <= 24, `${key} saturation ${c.s} should stay a tint, not a colour`);
  }
  // Where there is enough lightness headroom to hold a hue accurately, the
  // tint really is the brand's hue. (wash/surface sit at L97+, where 8-bit
  // rounding leaves too few steps for the hue to survive a round-trip.)
  for (const key of ['ink', 'muted', 'hairline']) {
    const c = hexToHsl(p[key]);
    assert.ok(Math.abs(c.h - hue) <= 8, `${key} hue ${c.h} should track the brand hue ${hue}`);
  }
  // ...and they are never flat white or black.
  assert.notEqual(p.wash, '#ffffff');
  assert.notEqual(p.ink, '#000000');
});

test('dark mode flips the neutrals but keeps the brand', () => {
  const light = buildPalette({ primaryColor: '#1f6feb' });
  const dark = buildPalette({ primaryColor: '#1f6feb', backgroundStyle: 'dark' });
  assert.equal(light.brand, dark.brand);
  assert.equal(light.isDark, false);
  assert.equal(dark.isDark, true);
  assert.ok(hexToHsl(dark.wash).l < 20);
  assert.ok(hexToHsl(dark.ink).l > 80);
});

test('font labels map to style categories, not one generic sans', () => {
  assert.equal(fontCategory('Playfair Display'), 'serif');
  assert.equal(fontCategory('Merriweather'), 'serif');
  assert.equal(fontCategory('Georgia'), 'serif');
  assert.equal(fontCategory('Zilla Slab'), 'serif');
  assert.equal(fontCategory('Inter'), 'sans');
  assert.equal(fontCategory('Helvetica'), 'sans');
  assert.equal(fontCategory('JetBrains Mono'), 'mono');
  assert.equal(fontCategory('Archivo Narrow'), 'condensed');
  // Unknown and unsafe labels fall back rather than throwing.
  assert.equal(fontCategory(''), 'sans');
  assert.equal(fontCategory(null), 'sans');
  assert.equal(fontCategory('Evil"; } body { x: 1 }'), 'sans');
});

test('a font stack never carries an injection or a downloaded file', () => {
  assert.match(fontStack('Inter'), /^'Inter', /);
  // A serif brand renders a serif stack even though no file is fetched.
  assert.match(fontStack('Playfair Display'), /Georgia/);
  assert.match(fontStack('Inter'), /Helvetica/);

  for (const bad of ["x'; } @import url('http://attacker/f.css'); .a {", 'Font"; behavior: url(#evil)', '</style><script>']) {
    const stack = fontStack(bad);
    assert.equal(stack.includes('url('), false);
    assert.equal(stack.includes('@import'), false);
    assert.equal(stack.includes('<'), false);
    assert.equal(stack.includes('"'), false);
  }
});

test('the headline scale responds to length so type never dumps or overflows', () => {
  const short = headlineScale('Roofs fixed');
  const long = headlineScale('Emergency roof repair and full replacement for homes across Greater London');
  assert.ok(short.size > long.size, 'a short headline should be set larger');
  assert.ok(long.leading > short.leading, 'a long headline should get looser leading');
  assert.equal(typeof short.tracking, 'string');
  // Non-square canvases scale the whole system rather than reflowing.
  assert.ok(headlineScale('Roofs fixed', { base: 0.62 }).size < short.size);
  assert.ok(subheadlineScale('short').size >= subheadlineScale('x'.repeat(140)).size);
});

test('text is clamped to the documented limits', () => {
  assert.equal(clampText('  hello  ', 80), 'hello');
  assert.equal(clampText(null, 80), '');
  assert.equal(clampText(undefined, 80), '');
  const long = clampText('x'.repeat(200), 80);
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
});

test('the eyebrow uses real business data and never invents copy', () => {
  assert.equal(eyebrowFrom({ brandName: 'Acme Roofing' }), 'ACME ROOFING');
  // Falls back to the category when there is no brand name.
  assert.equal(eyebrowFrom({ businessCategory: 'Roofing contractor' }), 'ROOFING CONTRACTOR');
  // Nothing to say means nothing is rendered.
  assert.equal(eyebrowFrom({}), '');
});

test('validators reject everything that is not exactly what they expect', () => {
  assert.equal(safeColor('#AABBCC'), '#aabbcc');
  assert.equal(safeColor('#fff'), null);
  assert.equal(safeColor('red'), null);
  assert.equal(safeColor('#123456; } body {}'), null);
  assert.equal(safeImageUrl('https://cdn.example.com/l.png'), 'https://cdn.example.com/l.png');
  assert.equal(safeImageUrl('http://cdn.example.com/l.png'), '');
  assert.equal(safeImageUrl('//cdn.example.com/l.png'), '');
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('data:image/svg+xml,<svg/>'), '');
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
