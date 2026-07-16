import './helpers/setupEnv.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTemplate,
  normalizeTemplate,
  listTemplates,
  escapeHtml,
  safeColor,
  safeImageUrl,
  DEFAULT_TEMPLATE,
} from '../src/templates/socialImageTemplates.js';
import { LAYOUT_LABELS } from '../src/templates/layouts/index.js';
import { sanitizeForTest } from '../src/services/socialImageService.js';
import { hexToHsl, contrastRatio } from '../src/templates/brandKit.js';
import {
  IMAGE_TEMPLATES,
  IMAGE_TEMPLATE_VALUES,
  LEGACY_IMAGE_TEMPLATE_ALIASES,
  PLANNER_DESIGN_FAMILIES,
} from '../src/config/constants.js';

const BRAND = {
  brandName: 'Acme Roofing',
  businessCategory: 'Roofing contractor',
  serviceTag: 'Roof repair',
  headline: 'Roof repairs done right, first time',
  subheadline: 'Same-week appointments across Greater London. Fully insured crews.',
  logoUrl: 'https://cdn.example.com/logo.png',
  primaryColor: '#123456',
  secondaryColor: '#64748b',
  accentColor: '#ff0088',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
  cta: 'Book a free quote',
  website: 'acme-roofing.com',
  phone: '+44 20 7946 0100',
};

/** Crude but effective structural check: every tag opened is closed. */
function assertBalancedHtml(html, label) {
  const VOID = new Set(['img', 'br']);
  const stack = [];
  const re = /<(\/?)([a-z0-9]+)[^>]*?(\/?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, closing, tag, selfClosing] = m;
    if (VOID.has(tag.toLowerCase()) || selfClosing) continue;
    if (closing) {
      assert.equal(stack.pop(), tag.toLowerCase(), `${label}: unbalanced </${tag}>`);
    } else {
      stack.push(tag.toLowerCase());
    }
  }
  assert.deepEqual(stack, [], `${label}: unclosed tags`);
}

test('the template set leads with the planner design families', () => {
  assert.deepEqual([...IMAGE_TEMPLATES], [
    // Phase 4.7.1 design families — what the planner selects from.
    'editorial-insight', 'light-editorial', 'checklist-guide', 'comparison-cards',
    'stat-highlight', 'service-authority', 'local-insight',
    // Phase 4.8 — two structurally distinct additions.
    'numbered-steps', 'faq-editorial',
    // Earlier layouts, kept so existing drafts still render.
    'editorial-premium', 'bold-service-promo', 'local-authority',
    'modern-split', 'minimal-luxury', 'geometric-conversion',
    'checklist-tips', 'stat-proof', 'split-comparison',
    'photo-overlay',
  ]);
  // Every design family really has a layout behind it.
  for (const id of PLANNER_DESIGN_FAMILIES) {
    assert.ok(IMAGE_TEMPLATES.includes(id), `${id} must be offerable`);
    assert.ok(LAYOUT_LABELS[id], `${id} needs a layout module`);
  }
  // Every advertised template really has a layout behind it.
  for (const id of IMAGE_TEMPLATES) assert.ok(LAYOUT_LABELS[id], `${id} needs a layout module`);
  assert.equal(listTemplates().length, IMAGE_TEMPLATES.length);
});

test('every template renders valid, balanced HTML with the full brand kit', () => {
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({ ...BRAND, template, aspectRatio: 'square' });
    assert.equal(built.template, template);
    assert.equal(built.templateLabel, LAYOUT_LABELS[template]);
    assert.equal(built.width, 1080);
    assert.equal(built.height, 1080);
    assertBalancedHtml(built.html, template);
    assert.match(built.html, new RegExp(`class="canvas tpl-${template}"`));
    assert.match(built.html, /<h1 class="headline">/);
    // Every layout is scoped, so two stylesheets can coexist without collision.
    assert.ok(built.css.includes(`.tpl-${template} `), `${template} css must be scoped`);
    assert.equal(built.css.includes('undefined'), false, `${template} css has an undefined value`);
    assert.equal(built.html.includes('undefined'), false, `${template} html has an undefined value`);
    assert.equal(built.html.includes('[object Object]'), false);
  }
});

test('each template has a genuinely distinct structure', () => {
  const structures = IMAGE_TEMPLATES.map((template) => {
    const { html } = buildTemplate({ ...BRAND, template });
    // Compare the class vocabulary each layout introduces.
    return [...new Set(html.match(/class="([^"]+)"/g) || [])].sort().join('|');
  });
  assert.equal(new Set(structures).size, IMAGE_TEMPLATES.length, 'templates must not be visual duplicates');
});

test('all seven layouts carry every supplied brand element', () => {
  for (const template of IMAGE_TEMPLATES) {
    const { html } = buildTemplate({ ...BRAND, template });
    assert.match(html, /Roof repairs done right, first time/, `${template} headline`);
    assert.match(html, /Same-week appointments/, `${template} subheadline`);
    assert.match(html, /Book a free quote/, `${template} cta`);
    assert.match(html, /acme-roofing\.com/, `${template} website`);
    assert.match(html, /\+44 20 7946 0100/, `${template} phone`);
    assert.match(html, /<img class="logo[^"]*" src="https:\/\/cdn\.example\.com\/logo\.png"/, `${template} logo`);
    // The brand is present either as the footer lockup or the eyebrow.
    assert.ok(/Acme Roofing|ACME ROOFING/.test(html), `${template} brand name`);
  }
});

test('legacy template names still render, so older drafts keep working', () => {
  for (const [legacy, expected] of Object.entries(LEGACY_IMAGE_TEMPLATE_ALIASES)) {
    assert.equal(normalizeTemplate(legacy), expected, `${legacy} should map to ${expected}`);
    assert.equal(buildTemplate({ template: legacy, headline: 'Hi' }).template, expected);
    assert.ok(IMAGE_TEMPLATE_VALUES.includes(legacy), `${legacy} must stay API-accepted`);
  }
  // Phase 4/4.5b names are all still accepted.
  for (const old of ['minimal', 'bold', 'professional', 'editorial', 'bold-service', 'professional-local']) {
    assert.ok(IMAGE_TEMPLATE_VALUES.includes(old));
  }
  // Anything unknown falls back rather than throwing.
  assert.equal(normalizeTemplate('not-a-template'), DEFAULT_TEMPLATE);
  assert.equal(normalizeTemplate(null), DEFAULT_TEMPLATE);
  assert.equal(buildTemplate({ template: {}, headline: 'Hi' }).template, DEFAULT_TEMPLATE);
});

test('user text is escaped and can never become markup', () => {
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({
      template,
      brandName: 'Acme & Co',
      headline: '<script>alert(1)</script>',
      subheadline: '"><img src=x onerror=alert(2)>',
      cta: 'Click <b>here</b>',
      website: `evil'"`,
      phone: '</style><script>alert(3)</script>',
      serviceTag: '<svg onload=alert(4)>',
      businessCategory: '"><iframe src=//evil>',
    });
    // No hostile tag survives as markup...
    assert.equal(built.html.includes('<script'), false, `${template} script tag`);
    assert.equal(built.html.includes('<b>'), false, `${template} b tag`);
    assert.equal(built.html.includes('<iframe'), false, `${template} iframe`);
    assert.equal(built.html.includes('<svg'), false, `${template} svg`);
    assert.equal(built.html.includes('</style>'), false, `${template} style break-out`);

    /*
     * ...and no real tag carries a handler or a script URL. Substring checks
     * for "onerror=" would fail here for the wrong reason: escaped text like
     * "&lt;img src=x onerror=alert(2)&gt;" legitimately contains that sequence
     * as inert characters. What matters is that it is not inside a tag.
     */
    for (const tag of built.html.match(/<[^>]+>/g) || []) {
      assert.equal(/\son[a-z]+\s*=/i.test(tag), false, `${template}: handler in ${tag}`);
      assert.equal(/javascript:/i.test(tag), false, `${template}: js url in ${tag}`);
      assert.equal(/\sstyle\s*=/i.test(tag), false, `${template}: inline style in ${tag}`);
    }
    // The dangerous text is present, but only as escaped, inert characters.
    assert.match(built.html, /&lt;script&gt;/);
    // The brand name is escaped wherever a layout places it — some render it
    // as a footer lockup, others as an uppercased eyebrow.
    assert.match(built.html, /Acme &amp; Co|ACME &amp; CO/);
    assertBalancedHtml(built.html, `${template} (hostile input)`);
    // A hostile <img> in text never becomes the one real <img> we allow.
    const imgs = built.html.match(/<img[^>]*>/g) || [];
    assert.deepEqual(imgs, [], `${template} must render no img when there is no valid logo`);
  }
});

test('brand colours are applied but only ever as validated hex', () => {
  const built = buildTemplate({ ...BRAND, template: 'editorial-premium' });
  // Colours are derived, not pasted: the raw input never appears verbatim...
  const hexes = built.css.match(/#[0-9a-f]{6}/gi) || [];
  assert.ok(hexes.length > 0);
  // ...but the brand's hue is preserved, so it still looks like their brand.
  const primaryHue = hexToHsl('#123456').h;
  const cssHues = hexes.map((h) => hexToHsl(h.toLowerCase()).h);
  assert.ok(cssHues.some((h) => Math.abs(h - primaryHue) <= 6), 'the primary hue must survive into the CSS');
  const accentHue = hexToHsl('#ff0088').h;
  assert.ok(cssHues.some((h) => Math.abs(h - accentHue) <= 6), 'the accent hue must survive into the CSS');

  // Only hex, rgba() and gradients — never a raw value from the caller.
  const colourish = built.css.match(/(?:background|color|border-color)\s*:\s*([^;]+);/g) || [];
  for (const decl of colourish) {
    assert.equal(/expression\(|javascript:|url\(/.test(decl), false, `unsafe declaration: ${decl}`);
  }
});

test('hostile colour and font values never reach the CSS', () => {
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({
      ...BRAND,
      template,
      primaryColor: 'red; } * { background: url(http://attacker) }',
      secondaryColor: 'javascript:alert(1)',
      accentColor: '#12345',
      headingFont: "x'; } @import url('http://attacker/f.css'); .a {",
      bodyFont: 'Font"; behavior: url(#evil)',
    });
    assert.equal(built.css.includes('attacker'), false, `${template} leaked a hostile colour/font`);
    assert.equal(built.css.includes('@import'), false, `${template} allowed an @import`);
    assert.equal(built.css.includes('javascript:'), false, `${template} allowed a js: url`);
    assert.equal(built.css.includes('behavior:'), false, `${template} allowed behavior:`);
    assert.equal(built.css.includes('expression('), false, `${template} allowed expression()`);
  }
});

test('no template fetches a remote asset or invents a photo', () => {
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({ ...BRAND, template });
    // No url() at all: a render can never pull a stock photo, font, or tracker.
    assert.deepEqual(built.css.match(/url\(([^)]*)\)/g) || [], [], `${template} must not use url()`);
    // The business's own validated logo is the only image that may exist.
    const imgs = built.html.match(/<img[^>]*>/g) || [];
    assert.ok(imgs.length <= 1, `${template} should render at most one image`);
    for (const img of imgs) assert.match(img, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  }
  // The overlay layout keeps a real slot for a future image provider.
  const overlay = buildTemplate({ ...BRAND, template: 'photo-overlay' });
  assert.match(overlay.html, /class="photo-slot"/);
  assert.match(overlay.css, /\.tpl-photo-overlay \.photo-slot/);
  assert.match(overlay.css, /\.tpl-photo-overlay \.scrim/);
});

test('the logo renders only for an absolute https URL', () => {
  assert.match(
    buildTemplate({ ...BRAND, template: 'editorial-premium' }).html,
    /<img class="logo logo-right" src="https:\/\/cdn\.example\.com\/logo\.png" alt="">/,
  );
  for (const bad of [
    'http://cdn.example.com/l.png',
    '//cdn.example.com/l.png',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)/>',
    '/local/l.png',
    'https://',
    '',
    null,
  ]) {
    for (const template of IMAGE_TEMPLATES) {
      const built = buildTemplate({ ...BRAND, template, logoUrl: bad });
      assert.equal(built.html.includes('<img'), false, `${template} rendered an img for ${bad}`);
      assert.equal(built.html.includes('javascript:'), false);
      assert.equal(built.html.includes('data:'), false);
      // Dropping the logo must not leave a hole or unbalance the layout.
      assertBalancedHtml(built.html, `${template} (no logo)`);
      assert.match(built.html, /class="headline"/);
    }
  }
});

test('optional modules appear only when supplied', () => {
  for (const template of IMAGE_TEMPLATES) {
    const full = buildTemplate({ ...BRAND, template });
    assert.ok(full.html.includes('class="cta'), `${template} should render a CTA when given one`);

    // Each module can be dropped independently without breaking the layout.
    const noCta = buildTemplate({ ...BRAND, template, cta: null });
    assert.equal(noCta.html.includes('class="cta'), false, `${template} must omit an empty CTA`);
    assertBalancedHtml(noCta.html, `${template} (no cta)`);

    const noWebsite = buildTemplate({ ...BRAND, template, website: null });
    assert.equal(noWebsite.html.includes('acme-roofing.com'), false, `${template} must omit an empty website`);

    const noPhone = buildTemplate({ ...BRAND, template, phone: null });
    assert.equal(noPhone.html.includes('+44 20 7946 0100'), false, `${template} must omit an empty phone`);

    // With no contact details at all, the footer disappears rather than
    // rendering an empty bar.
    const bare = buildTemplate({ ...BRAND, template, website: null, phone: null, brandName: null });
    assert.equal(/class="footer[ "]/.test(bare.html), false, `${template} must omit an empty footer`);
    assert.ok(/class="footer[ "]/.test(full.html), `${template} should render a footer when given details`);
  }
});

test('a headline alone still produces a complete design', () => {
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({ template, headline: 'We are open on Sundays' });
    assertBalancedHtml(built.html, `${template} (headline only)`);
    assert.match(built.html, /We are open on Sundays/);
    assert.equal(built.html.includes('<img'), false);
    assert.equal(built.html.includes('class="cta'), false);
    assert.equal(built.html.includes('class="subheadline"'), false);
    assert.equal(built.html.includes('class="tag"'), false);
    assert.equal(built.css.includes('undefined'), false);
    // The layout still gets a full palette to work with.
    assert.match(built.css, /#[0-9a-f]{6}/);
  }
});

test('the CTA is always readable on the accent it sits on', () => {
  // A brand whose accent leaves neither black nor white readable at its native
  // lightness must still ship a legible button.
  for (const accentColor of ['#ff0088', '#e0653a', '#00ff00', '#ffff00', '#808080']) {
    const built = buildTemplate({ ...BRAND, accentColor, template: 'geometric-conversion' });
    const cta = /\.tpl-geometric-conversion \.cta \{[^}]*background: (#[0-9a-f]{6}); color: (#[0-9a-f]{6})/.exec(built.css);
    assert.ok(cta, `could not find the CTA rule for ${accentColor}`);
    assert.ok(
      contrastRatio(cta[2], cta[1]) >= 4.5,
      `CTA contrast for ${accentColor} is ${contrastRatio(cta[2], cta[1]).toFixed(2)}`,
    );
  }
});

test('text is clamped so no input can overrun a layout', () => {
  const built = buildTemplate({
    ...BRAND,
    template: 'editorial-premium',
    headline: 'x'.repeat(500),
    subheadline: 'y'.repeat(500),
    cta: 'z'.repeat(200),
  });
  assert.equal(/x{81}/.test(built.html), false, 'headline must be capped at 80');
  assert.equal(/y{141}/.test(built.html), false, 'subheadline must be capped at 140');
  assert.equal(/z{41}/.test(built.html), false, 'cta must be capped at 40');
  assertBalancedHtml(built.html, 'clamped');
});

test('the type scale adapts to headline length', () => {
  const short = buildTemplate({ ...BRAND, headline: 'Roofs fixed' });
  const long = buildTemplate({ ...BRAND, headline: 'x'.repeat(78) });
  const sizeOf = (css) => Number(/\.headline \{[^}]*font-size: (\d+)px/.exec(css)[1]);
  assert.ok(sizeOf(short.css) > sizeOf(long.css), 'a short headline should be set larger');
});

test('every aspect ratio renders at its documented pixel size', () => {
  const sizes = { square: [1080, 1080], portrait: [1080, 1350], landscape: [1200, 630] };
  for (const [aspectRatio, [width, height]] of Object.entries(sizes)) {
    for (const template of IMAGE_TEMPLATES) {
      const built = buildTemplate({ ...BRAND, template, aspectRatio });
      assert.equal(built.width, width);
      assert.equal(built.height, height);
      assert.match(built.css, new RegExp(`width: ${width}px; height: ${height}px`));
      assertBalancedHtml(built.html, `${template} ${aspectRatio}`);
    }
  }
  // An unknown ratio falls back to square rather than throwing.
  assert.equal(buildTemplate({ ...BRAND, aspectRatio: 'billboard' }).width, 1080);
});

test('an arbitrary background style is ignored in favour of a safe preset', () => {
  const built = buildTemplate({
    ...BRAND,
    backgroundStyle: 'evil { background: url(http://attacker) }',
  });
  assert.equal(built.css.includes('attacker'), false);
  assert.equal(built.css.includes('evil'), false);
  // Dark is a real preset and does flip the canvas.
  const dark = buildTemplate({ ...BRAND, backgroundStyle: 'dark' });
  const light = buildTemplate({ ...BRAND, backgroundStyle: 'light' });
  assert.notEqual(dark.css, light.css);
});

test('every layout survives sanitization structurally intact', () => {
  /*
   * The renderer is handed the SANITIZED html, not buildTemplate's output. A
   * tag missing from the allow-list is silently discarded (its text is kept),
   * which would flatten a layout without any error — so assert the structure
   * that actually reaches HCTI, element for element.
   */
  for (const template of IMAGE_TEMPLATES) {
    const built = buildTemplate({ ...BRAND, template });
    const safe = sanitizeForTest(built.html);

    const tagsIn = (html) => (html.match(/<([a-z0-9]+)[\s>]/gi) || []).map((t) => t.slice(1).trim().toLowerCase());
    assert.deepEqual(tagsIn(safe), tagsIn(built.html), `${template}: sanitization changed the element structure`);

    // Every class the stylesheet targets must still be there afterwards.
    const classesIn = (html) => (html.match(/class="[^"]*"/g) || []).join('|');
    assert.equal(classesIn(safe), classesIn(built.html), `${template}: sanitization dropped a class hook`);

    assert.match(safe, new RegExp(`class="canvas tpl-${template}"`));
    assert.match(safe, /class="content/);
    assert.match(safe, /<h1 class="headline">/);
    assert.match(safe, /Book a free quote/);
    assert.match(safe, /<img class="logo/);
  }
});

test('sanitization still strips anything that is not an inert layout element', () => {
  const hostile =
    '<div class="canvas"><script>alert(1)</script><iframe src="https://evil"></iframe>' +
    '<form><input name="x"></form><div class="x" style="color:red" onclick="alert(2)">ok</div>' +
    '<img class="logo" src="http://insecure/l.png" alt=""><img class="logo" src="javascript:alert(3)" alt="">' +
    '<a href="https://evil">link</a><object data="x"></object></div>';
  const safe = sanitizeForTest(hostile);
  assert.equal(safe.includes('<script'), false);
  assert.equal(safe.includes('<iframe'), false);
  assert.equal(safe.includes('<form'), false);
  assert.equal(safe.includes('<input'), false);
  assert.equal(safe.includes('<object'), false);
  assert.equal(safe.includes('<a '), false);
  assert.equal(safe.includes('style='), false, 'inline styles must never survive');
  assert.equal(safe.includes('onclick'), false, 'handlers must never survive');
  // Non-https image sources are dropped.
  assert.equal(safe.includes('http://insecure'), false);
  assert.equal(safe.includes('javascript:'), false);
  // ...while the legitimate structure and classes are kept.
  assert.match(safe, /class="canvas"/);
  assert.match(safe, /class="x"/);
});

test('content-type layouts render their structured data', () => {
  const checklist = buildTemplate({
    ...BRAND,
    template: 'checklist-tips',
    bullets: ['Clear the gutters', 'Check flashing seals', 'Look for lifted tiles'],
  });
  assert.match(checklist.html, /Clear the gutters/);
  assert.match(checklist.html, /class="marker">1</);
  assert.match(checklist.html, /class="marker">3</);

  const stat = buildTemplate({
    ...BRAND, template: 'stat-proof', stat: { value: '92%', label: 'first-visit fixes' },
  });
  assert.match(stat.html, /class="stat-value">92%</);
  assert.match(stat.html, /first-visit fixes/);

  const comparison = buildTemplate({
    ...BRAND,
    template: 'split-comparison',
    comparison: {
      leftTitle: 'Quick patch', leftItems: ['Cheaper today'],
      rightTitle: 'Proper repair', rightItems: ['Fixes the cause'],
    },
  });
  assert.match(comparison.html, /Quick patch/);
  assert.match(comparison.html, /Proper repair/);
  assert.match(comparison.html, /class="versus">vs</);
});

test('content-type layouts fall back cleanly when structured data is missing', () => {
  // A generation miss must degrade to a plain card, never an empty frame.
  for (const template of ['checklist-tips', 'stat-proof', 'split-comparison']) {
    const built = buildTemplate({ ...BRAND, template });
    assertBalancedHtml(built.html, `${template} (no structured data)`);
    assert.match(built.html, /Roof repairs done right, first time/);
    // The empty structures are omitted entirely.
    assert.equal(built.html.includes('class="list"'), false);
    assert.equal(built.html.includes('class="stat"'), false);
    assert.equal(built.html.includes('class="compare"'), false);
    // ...and the subheadline stands in for them.
    assert.match(built.html, /class="subheadline"/);
  }
});

test('structured visual data is escaped, clamped and count-limited', () => {
  const built = buildTemplate({
    ...BRAND,
    template: 'checklist-guide',
    // A checklist renders at most 5 items, so the 6th and 7th must be dropped.
    bullets: ['<script>alert(1)</script>', 'x'.repeat(200), 'three', 'four', 'five', 'six', 'seven'],
  });
  assert.equal(built.html.includes('<script'), false);
  assert.match(built.html, /&lt;script&gt;/);
  assert.equal(/x{65}/.test(built.html), false, 'a bullet must be clamped');
  assert.equal(built.html.includes('>six<'), false, 'bullets must be count-limited');
  assert.equal(built.html.includes('>seven<'), false, 'bullets must be count-limited');
  assertBalancedHtml(built.html, 'hostile bullets');

  const stat = buildTemplate({
    ...BRAND, template: 'stat-proof',
    stat: { value: '"><img src=x>', label: '<b>label</b>' },
  });
  // The only <img> may be the business's own validated logo — the hostile one
  // in the stat value must not have become a second tag.
  const imgs = stat.html.match(/<img[^>]*>/g) || [];
  assert.equal(imgs.length, 1);
  assert.match(imgs[0], /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  assert.equal(stat.html.includes('<b>'), false);
  assert.match(stat.html, /&lt;b&gt;label/);
});

test('list layouts survive sanitization (their lists are real lists)', () => {
  // ul/li must be in the allow-list: discarding them keeps the text but
  // silently flattens the layout, which no error would reveal.
  const checklist = sanitizeForTest(
    buildTemplate({ ...BRAND, template: 'checklist-tips', bullets: ['One', 'Two'] }).html,
  );
  assert.match(checklist, /<ul class="list">/);
  assert.match(checklist, /<li class="row">/);

  const comparison = sanitizeForTest(
    buildTemplate({
      ...BRAND, template: 'split-comparison',
      comparison: { leftTitle: 'A', leftItems: ['x'], rightTitle: 'B', rightItems: ['y'] },
    }).html,
  );
  assert.match(comparison, /<ul class="col-list">/);
  assert.match(comparison, /<li class="col-item">/);
});

test('brand-coloured text stays readable on the canvas in both modes', () => {
  // A dark navy brand on a dark canvas would otherwise vanish.
  for (const backgroundStyle of ['light', 'dark']) {
    for (const primaryColor of ['#123456', '#00ff00', '#ffffff', '#0b0b0b']) {
      const built = buildTemplate({
        ...BRAND, primaryColor, backgroundStyle, template: 'stat-proof',
        stat: { value: '92%', label: 'fixes' },
      });
      const wash = /\.tpl-stat-proof \{ background: (#[0-9a-f]{6})/.exec(built.css);
      const statColour = /\.stat-value \{[^}]*color: (#[0-9a-f]{6})/.exec(built.css);
      assert.ok(wash && statColour, `could not read colours for ${primaryColor}/${backgroundStyle}`);
      const ratio = contrastRatio(statColour[1], wash[1]);
      assert.ok(ratio >= 4.5, `stat/wash contrast ${ratio.toFixed(2)} for ${primaryColor} ${backgroundStyle}`);
    }
  }
});

test('re-exported validators behave as the templates rely on', () => {
  assert.equal(safeColor('#AABBCC'), '#aabbcc');
  assert.equal(safeColor('nope'), null);
  assert.equal(safeImageUrl('https://a.example/x.png'), 'https://a.example/x.png');
  assert.equal(safeImageUrl('http://a.example/x.png'), '');
  assert.equal(escapeHtml('<x>'), '&lt;x&gt;');
});
