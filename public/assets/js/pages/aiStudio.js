/**
 * AI Studio — the visible, on-demand poster + caption generator.
 *
 * Modeled on the dark "studio" tool: a controls panel on the left, the generated
 * poster + captions on the right. It calls POST /api/ai-studio/generate, which
 * runs the same Claude engine the daily automation uses and renders the poster
 * for free (no browser) with resvg. Nothing here publishes — it is a place to SEE
 * and test the AI design + copy, and download a poster.
 */

import * as api from '../api.js';
import { el, toast } from '../ui.js';

const STYLES = [
  { id: 'showcase', label: 'Product Showcase' },
  { id: 'editorial', label: 'Editorial Clean' },
  { id: 'dynamic', label: 'Dynamic Geometric' },
];

const CAPTIONS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'threads', label: 'Threads' },
];

/** A labelled control row. */
function row(label, control, hint) {
  return el('label', { className: 'ais-row' }, [
    el('span', { className: 'ais-label', text: label }),
    control,
    hint ? el('span', { className: 'ais-hint', text: hint }) : null,
  ]);
}

function input(value, placeholder, max = 120) {
  return el('input', {
    className: 'ais-input',
    attrs: { type: 'text', value: value || '', placeholder: placeholder || '', maxlength: max },
  });
}

/** A colour control: a swatch (type=color) kept in sync with a hex text field. */
function colorControl(label, value) {
  const swatch = el('input', { className: 'ais-swatch', attrs: { type: 'color', value } });
  const text = el('input', { className: 'ais-input ais-hex', attrs: { type: 'text', value, maxlength: 7, spellcheck: 'false' } });
  swatch.addEventListener('input', () => { text.value = swatch.value; });
  text.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(text.value)) swatch.value = text.value; });
  return {
    node: el('div', { className: 'ais-color' }, [el('span', { className: 'ais-label', text: label }), el('div', { className: 'ais-color-in' }, [swatch, text])]),
    get: () => text.value,
    /** Used by the analyze bar. Ignores anything that is not a real hex. */
    set: (v) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(String(v || ''))) return;
      text.value = v;
      swatch.value = v;
    },
  };
}

export async function render(root, ctx) {
  const profile = await api.businessProfile().catch(() => null);
  // The heading font, from the saved brand or from an analyzed website. It is
  // passed to the designer as a preference, not a guarantee — the renderer only
  // ships two faces, so the design prompt picks whichever suits.
  let analyzedFont = profile?.headingFont || '';

  const page = el('div', { className: 'ai-studio' });
  root.appendChild(page);

  // --- header --------------------------------------------------------------
  page.appendChild(el('header', { className: 'ais-head' }, [
    el('div', { className: 'ais-brand' }, [
      el('span', { className: 'ais-dot' }),
      el('h1', { text: 'AI Studio' }),
      el('span', { className: 'ais-tag mono', text: 'Claude designs a poster + writes your post copy' }),
    ]),
    el('p', { className: 'ais-sub', text: 'Confirm your brand, add a topic, and generate a ready poster with Facebook, Instagram and Threads post copy. Nothing is published here.' }),
  ]));

  /*
   * The analyze bar: type a website, and the brand fills itself in.
   *
   * It reuses the analyzer the onboarding flow already uses, so it reads the
   * real site rather than guessing — and it only PREFILLS. Nothing is saved, and
   * every field stays editable, because a site read is a suggestion and the
   * business owner is the authority on their own brand.
   */
  const urlIn = el('input', {
    className: 'ais-input ais-url',
    attrs: { type: 'text', placeholder: 'Enter your website (e.g. yourbusiness.com)', spellcheck: 'false' },
  });
  const analyzeBtn = el('button', { className: 'ais-btn ais-analyze', attrs: { type: 'button' }, text: 'Analyze' });
  const analyzeNote = el('p', { className: 'ais-hint ais-analyze-note', text: '' });
  page.appendChild(el('div', { className: 'ais-urlbar' }, [
    el('div', { className: 'ais-urlrow' }, [urlIn, analyzeBtn]),
    analyzeNote,
  ]));

  const grid = el('div', { className: 'ais-grid' });
  page.appendChild(grid);

  // --- controls panel ------------------------------------------------------
  const nameIn = input(profile?.businessName, 'e.g. Lahore Fitness Club');
  const industryIn = input(profile?.businessCategory, 'e.g. Gym / fitness club');
  const toneIn = input('', 'e.g. energetic, bold, motivating');
  const primary = colorControl('Primary', profile?.primaryColor || '#111827');
  const secondary = colorControl('Secondary', profile?.secondaryColor || '#6b7280');
  const accent = colorControl('Accent', profile?.accentColor || profile?.primaryColor || '#2563eb');
  const angleIn = el('textarea', { className: 'ais-input ais-area', attrs: { rows: 3, maxlength: 400, placeholder: 'What is this post about? e.g. Launch our new 7-day free trial this week.' } });
  const styleSel = el('select', { className: 'ais-input' }, STYLES.map((s) => el('option', { text: s.label, attrs: { value: s.id } })));

  const genBtn = el('button', { className: 'ais-btn', attrs: { type: 'button' }, text: 'Generate' });

  const panel = el('div', { className: 'ais-panel' }, [
    row('Business name', nameIn),
    row('Industry', industryIn),
    row('Brand tone', toneIn, 'How should it sound?'),
    el('div', { className: 'ais-colors' }, [primary.node, secondary.node, accent.node]),
    row('Topic for this post', angleIn),
    row('Design style', styleSel),
    genBtn,
  ]);
  grid.appendChild(panel);

  // --- output --------------------------------------------------------------
  const output = el('div', { className: 'ais-output' });
  grid.appendChild(output);

  function showEmpty() {
    output.textContent = '';
    output.appendChild(el('div', { className: 'ais-empty' }, [
      el('p', { text: 'Your poster and post copy will appear here.' }),
      el('p', { className: 'ais-hint', text: 'Fill in the brand on the left and press Generate. Claude designs the poster and writes the copy — this takes about 30 to 60 seconds.' }),
    ]));
  }

  function showLoading() {
    output.textContent = '';
    output.appendChild(el('div', { className: 'ais-empty' }, [
      el('div', { className: 'ais-spinner' }),
      el('p', { text: 'Designing your poster and writing post copy…' }),
      el('p', { className: 'ais-hint', text: 'This takes about 30 to 60 seconds. Please keep this tab open.' }),
    ]));
  }

  function captionCard(label, text) {
    const body = el('p', { className: 'ais-cap-text', text: text || '' });
    const copy = el('button', { className: 'ais-copy', attrs: { type: 'button' }, text: 'Copy' });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text || ''); toast(`${label} post copy copied`, 'ok'); }
      catch { toast('Could not copy. Select the text manually.', 'warn'); }
    });
    return el('div', { className: 'ais-cap' }, [
      el('div', { className: 'ais-cap-head' }, [el('span', { className: 'ais-cap-label', text: label }), copy]),
      body,
    ]);
  }

  function showResult(data) {
    output.textContent = '';

    if (data.pngDataUrl) {
      const img = el('img', { className: 'ais-poster', attrs: { src: data.pngDataUrl, alt: data.headline || 'Generated poster', width: 1080, height: 1080 } });
      const slug = (nameIn.value || 'poster').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'poster';
      const dl = el('a', { className: 'ais-btn ais-dl', text: 'Download poster', attrs: { href: data.pngDataUrl, download: `${slug}.png` } });
      output.appendChild(el('div', { className: 'ais-poster-wrap' }, [img, dl]));
    } else if (data.imageNote) {
      output.appendChild(el('div', { className: 'ais-note', text: data.imageNote }));
    }

    const caps = data.captions || {};
    output.appendChild(el('div', { className: 'ais-caps' }, CAPTIONS.map((c) => captionCard(c.label, caps[c.key]))));

    if (Array.isArray(data.hashtags) && data.hashtags.length) {
      output.appendChild(el('div', { className: 'ais-tags' }, data.hashtags.map((h) => el('span', { className: 'ais-chip', text: h }))));
    }
  }

  let busy = false;
  async function generate() {
    if (busy) return;
    const businessName = nameIn.value.trim();
    if (!businessName) { toast('Enter your business name first.', 'warn'); nameIn.focus(); return; }

    busy = true;
    genBtn.disabled = true;
    genBtn.textContent = 'Generating…';
    showLoading();

    const res = await api.apiRequest('/api/ai-studio/generate', {
      method: 'POST',
      body: {
        businessName,
        industry: industryIn.value.trim(),
        tone: toneIn.value.trim(),
        primaryColor: primary.get(),
        secondaryColor: secondary.get(),
        accentColor: accent.get(),
        angle: angleIn.value.trim(),
        styleId: styleSel.value,
        font: analyzedFont,
      },
    });

    busy = false;
    genBtn.disabled = false;
    genBtn.textContent = 'Generate';

    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) {
      showEmpty();
      toast(api.errorMessage(res, 'The studio could not generate right now. Please try again.'), 'err');
      return;
    }
    showResult(api.payload(res) || {});
  }

  genBtn.addEventListener('click', generate);

  // --- analyze: read a website, prefill the brand ---------------------------
  let analyzing = false;
  async function analyze() {
    if (analyzing) return;
    const url = urlIn.value.trim();
    if (!url) { toast('Enter your website address first.', 'warn'); urlIn.focus(); return; }

    analyzing = true;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Reading…';
    analyzeNote.textContent = 'Reading your website and picking up the brand. This takes a few seconds.';

    const res = await api.apiRequest('/api/ai-studio/analyze', { method: 'POST', body: { url } });

    analyzing = false;
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';

    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) {
      analyzeNote.textContent = '';
      toast(api.errorMessage(res, 'That website could not be read. Fill the brand in by hand.'), 'err');
      return;
    }

    const data = api.payload(res) || {};
    const brand = data.brand || {};
    // Prefill only what was actually found — never blank a field the user typed.
    if (brand.businessName) nameIn.value = brand.businessName;
    if (brand.industry) industryIn.value = brand.industry;
    if (brand.tone) toneIn.value = brand.tone;
    if (brand.colors) {
      primary.set(brand.colors.primary);
      secondary.set(brand.colors.secondary);
      accent.set(brand.colors.accent);
    }
    analyzedFont = brand.font || analyzedFont;

    const found = [
      brand.businessName ? 'name' : null,
      brand.industry ? 'industry' : null,
      brand.colors ? 'colours' : null,
      brand.font ? 'font' : null,
    ].filter(Boolean);
    analyzeNote.textContent = found.length
      ? `Picked up your ${found.join(', ')}. Edit anything that is not right, add a topic, then press Generate.`
      : 'That site did not give much away. Fill the brand in by hand below.';
    toast('Brand picked up from your website', 'ok');
  }

  analyzeBtn.addEventListener('click', analyze);
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });

  showEmpty();
}

export default { render };
