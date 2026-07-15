import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTemplate,
  escapeHtml,
  safeColor,
  safeFontStack,
  safeImageUrl,
} from '../src/templates/socialImageTemplates.js';
import { IMAGE_TEMPLATES, LEGACY_IMAGE_TEMPLATE_ALIASES } from '../src/config/constants.js';

const BRAND = {
  brandName: 'Acme Roofing',
  headline: 'Roof repairs done right',
  subheadline: 'Same-week appointments across the city.',
  logoUrl: 'https://cdn.example.com/logo.png',
  primaryColor: '#123456',
  secondaryColor: '#abcdef',
  accentColor: '#ff0088',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
  cta: 'Book a free quote',
  website: 'acme-roofing.com',
  phone: '+1 555 0100',
};

test('all four branded layouts render with the full brand kit', () => {
  assert.deepEqual([...IMAGE_TEMPLATES], ['editorial', 'bold-service', 'professional-local', 'photo-overlay']);
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({ ...BRAND, template, aspectRatio: 'square', backgroundStyle: 'light' });
    assert.equal(built.template, template);
    assert.match(built.html, new RegExp(`tpl-${template}`));
    // Every supplied brand element reaches the layout.
    assert.match(built.html, /Acme Roofing|logo\.png/);
    assert.match(built.html, /Roof repairs done right/);
    assert.match(built.html, /Same-week appointments/);
    assert.match(built.html, /Book a free quote/);
    assert.match(built.html, /acme-roofing\.com/);
    assert.match(built.html, /\+1 555 0100/);
    assert.match(built.css, /#123456|#ff0088|#abcdef/);
    assert.match(built.css, /Playfair Display/);
    assert.match(built.css, /Inter/);
    assert.equal(built.width, 1080);
    assert.equal(built.height, 1080);
  }
});

test('legacy template names map onto branded layouts', () => {
  for (const [legacy, expected] of Object.entries(LEGACY_IMAGE_TEMPLATE_ALIASES)) {
    assert.equal(buildTemplate({ template: legacy, headline: 'Hi' }).template, expected);
  }
  // An unknown template never throws — it falls back to the default layout.
  assert.equal(buildTemplate({ template: 'not-a-template', headline: 'Hi' }).template, 'editorial');
});

test('user text is escaped and never becomes markup', () => {
  const built = buildTemplate({
    template: 'editorial',
    brandName: 'Acme & Co',
    headline: '<script>alert(1)</script>',
    subheadline: '"><img src=x onerror=alert(2)>',
    cta: `Click <b>here</b>`,
    website: `evil'"`,
  });
  assert.equal(built.html.includes('<script'), false);
  assert.equal(built.html.includes('<b>'), false);
  // The only <img> that can exist is one we built from a validated logo URL.
  assert.equal(built.html.includes('<img class="logo"'), false);
  assert.equal(built.html.includes('<img src=x'), false);
  assert.match(built.html, /&lt;script&gt;/);
  assert.match(built.html, /Acme &amp; Co/);
  assert.match(built.html, /&#39;|&quot;/);
});

test('only validated hex colours reach the CSS', () => {
  assert.equal(safeColor('#AABBCC', '#000000'), '#aabbcc');
  assert.equal(safeColor('red', '#000000'), '#000000');
  assert.equal(safeColor('#fff', '#000000'), '#000000');
  assert.equal(safeColor('#123456; } body { background: url(http://attacker)', '#000000'), '#000000');

  const built = buildTemplate({
    template: 'editorial',
    headline: 'Hi',
    primaryColor: 'red; } * { background: url(http://attacker) }',
    accentColor: 'javascript:alert(1)',
  });
  assert.equal(built.css.includes('attacker'), false);
  assert.equal(built.css.includes('javascript:'), false);
  assert.equal(built.css.includes('url(http'), false);
});

test('only plain font names reach the CSS', () => {
  assert.match(safeFontStack('Inter'), /'Inter'/);
  assert.equal(safeFontStack("Evil', sans-serif; } body { background: url(http://x) }").includes('url('), false);
  assert.equal(safeFontStack('Font"; behavior: url(#evil)').includes('behavior'), false);

  const built = buildTemplate({
    template: 'bold-service',
    headline: 'Hi',
    headingFont: "x'; } @import url('http://attacker/f.css'); .a {",
  });
  assert.equal(built.css.includes('@import'), false);
  assert.equal(built.css.includes('attacker'), false);
});

test('only an absolute https logo URL is rendered as an image', () => {
  assert.equal(safeImageUrl('https://cdn.example.com/l.png'), 'https://cdn.example.com/l.png');
  assert.equal(safeImageUrl('http://cdn.example.com/l.png'), '');
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('data:image/svg+xml;base64,AAAA'), '');
  assert.equal(safeImageUrl('//cdn.example.com/l.png'), '');
  assert.equal(safeImageUrl('/local/l.png'), '');

  assert.match(buildTemplate({ ...BRAND, template: 'editorial' }).html, /<img class="logo" src="https:\/\/cdn\.example\.com\/logo\.png"/);
  for (const bad of ['http://cdn.example.com/l.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>']) {
    const built = buildTemplate({ ...BRAND, template: 'editorial', logoUrl: bad });
    assert.equal(built.html.includes('<img'), false);
    assert.equal(built.html.includes('javascript:'), false);
    assert.equal(built.html.includes('data:'), false);
  }
});

test('templates never invent photos and photo-overlay keeps a real image slot', () => {
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({ ...BRAND, template });
    // No stock/remote imagery is fetched — the only remote asset is the logo.
    const remote = built.css.match(/url\(([^)]*)\)/g) || [];
    assert.deepEqual(remote, [], `template ${template} must not fetch any CSS url()`);
    const imgs = built.html.match(/<img[^>]*>/g) || [];
    assert.ok(imgs.length <= 1);
    for (const img of imgs) assert.match(img, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  }
  // The overlay layout keeps a dedicated background slot for a future provider.
  const overlay = buildTemplate({ ...BRAND, template: 'photo-overlay' });
  assert.match(overlay.html, /class="photo-slot"/);
  assert.match(overlay.css, /\.photo-slot/);
  assert.match(overlay.css, /\.scrim/);
});

test('missing brand values degrade to a clean preset without empty markup', () => {
  const built = buildTemplate({ template: 'editorial', headline: 'Only a headline', aspectRatio: 'landscape' });
  assert.match(built.html, /Only a headline/);
  assert.equal(built.html.includes('<img'), false);
  assert.equal(built.html.includes('class="cta"'), false);
  assert.equal(built.html.includes('class="meta"'), false);
  assert.equal(built.html.includes('class="subheadline"'), false);
  assert.equal(built.width, 1200);
  assert.equal(built.height, 630);
});

test('escapeHtml handles nullish and every dangerous character', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
