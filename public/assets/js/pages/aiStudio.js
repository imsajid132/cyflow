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

  /*
   * What the reader found, in full.
   *
   * The product rule is explicit: if the app found it, the user sees it — the
   * logo, both fonts, every colour, the services, the contact details, the
   * social links. A hidden field is a field nobody can correct, and a website
   * read is often almost-right rather than right. Everything here is editable,
   * and the extra colours are offered as swatches so a wrong role is one click
   * to fix rather than a hex to retype.
   */
  const brandPanel = el('section', { className: 'ais-brandcard', attrs: { hidden: true } });
  page.appendChild(brandPanel);

  /** A read-only detail line: label + value, hidden entirely when empty. */
  function detail(label, value) {
    if (!value) return null;
    return el('div', { className: 'ais-detail' }, [
      el('span', { className: 'ais-label', text: label }),
      el('span', { className: 'ais-detail-v', text: value }),
    ]);
  }

  function renderBrandPanel(data) {
    const b = data.brand || {};
    brandPanel.textContent = '';
    brandPanel.hidden = false;

    // --- identity: the logo beside the name -------------------------------
    const mark = b.logoUrl
      ? el('img', { className: 'ais-logo', attrs: { src: b.logoUrl, alt: `${b.businessName || 'Brand'} logo`, loading: 'lazy' } })
      : el('div', { className: 'ais-logo ais-logo-none', text: (b.businessName || '?').slice(0, 1).toUpperCase() });

    brandPanel.appendChild(el('div', { className: 'ais-brandhead' }, [
      mark,
      el('div', {}, [
        el('h2', { className: 'ais-brandname', text: b.businessName || 'Your brand' }),
        el('p', { className: 'ais-hint', text: [b.industry, data.sourceUrl].filter(Boolean).join(' · ') }),
        b.logoUrl && !b.logoValidated
          ? el('p', { className: 'ais-hint', text: 'The logo was found but could not be verified. Check it looks right.' })
          : null,
      ]),
    ]));

    // --- colours: the three roles, plus everything else the site used ------
    const swatchRow = (list) => el('div', { className: 'ais-swatches' }, list.map((c) => {
      const chip = el('button', {
        className: 'ais-sw', attrs: { type: 'button', title: `Use ${c}`, style: `background:${c}` },
      });
      // A found colour is one click from becoming the accent — the role the
      // reader gets wrong most often, because a site's brightest colour is not
      // always its accent.
      chip.addEventListener('click', () => { accent.set(c); toast(`Accent set to ${c}`, 'ok'); });
      return chip;
    }));

    const colourBlock = el('div', { className: 'ais-bgroup' }, [
      el('span', { className: 'ais-label', text: 'Colours found on your site' }),
      b.colorCandidates?.length
        ? swatchRow(b.colorCandidates)
        : el('span', { className: 'ais-hint', text: 'No extra colours were found. The three below are yours to set.' }),
      b.colorCandidates?.length ? el('span', { className: 'ais-hint', text: 'Click any colour to make it the accent.' }) : null,
    ]);

    // --- fonts, services, contact, social ---------------------------------
    const fonts = [b.fonts?.heading, b.fonts?.body].filter(Boolean);
    const c = b.contact || {};
    const place = [c.address, c.city, c.region, c.postalCode, c.country].filter(Boolean).join(', ');
    const socials = Object.entries(b.socialLinks || {}).filter(([, v]) => v);

    const details = el('div', { className: 'ais-details' }, [
      detail('Heading font', b.fonts?.heading),
      detail('Body font', b.fonts?.body),
      detail('Phone', c.phone),
      detail('Email', c.email),
      detail('Address', place),
      detail('Website', c.websiteUrl),
      detail('Tone', b.tone),
    ].filter(Boolean));

    const chips = (label, items) => (items.length
      ? el('div', { className: 'ais-bgroup' }, [
        el('span', { className: 'ais-label', text: label }),
        el('div', { className: 'ais-tags' }, items.map((t) => el('span', { className: 'ais-chip', text: t }))),
      ])
      : null);

    brandPanel.appendChild(el('div', { className: 'ais-brandbody' }, [
      b.description ? el('p', { className: 'ais-brandabout', text: b.description }) : null,
      colourBlock,
      details.children.length ? details : null,
      chips('Services', b.services || []),
      chips('Social', socials.map(([k]) => k)),
      fonts.length === 0 ? el('p', { className: 'ais-hint', text: 'No fonts were named on the site. Posters use the studio faces.' }) : null,
    ].filter(Boolean)));

    // --- what the reader could not do -------------------------------------
    if (data.warnings?.length) {
      brandPanel.appendChild(el('div', { className: 'ais-warn' }, [
        el('span', { className: 'ais-label', text: 'Worth knowing' }),
        el('ul', { className: 'ais-warnlist' }, data.warnings.map((w) => el('li', { text: String(w) }))),
      ]));
    }

    brandPanel.appendChild(el('p', {
      className: 'ais-hint',
      text: 'Everything above came from your website. Correct anything that is wrong in the panel below, then generate.',
    }));
  }

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
    analyzedFont = brand.fonts?.heading || analyzedFont;

    renderBrandPanel(data);
    analyzeNote.textContent = '';
    toast('Brand read from your website', 'ok');
  }

  analyzeBtn.addEventListener('click', analyze);
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });

  showEmpty();
}

export default { render };
