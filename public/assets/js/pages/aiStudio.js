/**
 * AI Studio — step 1: read the website, and show everything it says.
 *
 * The product rule for this screen is narrow and strict: it shows the BRAND, and
 * nothing else. There is no tone box, no topic box and no style picker, because
 * the user does not brief the AI — Claude decides what to post from the brand it
 * just read. Anything on this page that is not a fact about the business would
 * be a decision taken away from it.
 *
 * Everything the reader found is editable, including the logo. A website read is
 * a suggestion, often almost-right rather than right, and the owner is the
 * authority on their own business. A field nobody can correct is a field that
 * carries its mistake onto every poster.
 */

import * as api from '../api.js';
import { el, toast } from '../ui.js';

/** The shape this screen edits. Flat on purpose: every key is one control. */
function emptyBrand() {
  return {
    businessName: '', industry: '', description: '',
    logoUrl: '', logoValidated: false,
    headingFont: '', bodyFont: '',
    primary: '#111827', secondary: '#6b7280', accent: '#2563eb',
    colorCandidates: [],
    services: [], socials: [], images: [],
    phone: '', email: '', address: '', city: '', region: '', postalCode: '', country: '', websiteUrl: '',
  };
}

/** A labelled text control bound to `brand[key]`. */
function field(brand, key, label, { placeholder = '', area = false, max = 300 } = {}) {
  const input = area
    ? el('textarea', { className: 'ais-input ais-area', attrs: { rows: 3, maxlength: 600, placeholder } })
    : el('input', { className: 'ais-input', attrs: { type: 'text', maxlength: max, placeholder } });
  input.value = brand[key] || '';
  input.addEventListener('input', () => { brand[key] = input.value; });
  return el('label', { className: 'ais-row' }, [
    el('span', { className: 'ais-label', text: label }),
    input,
  ]);
}

/** A colour control: a swatch and a hex box, kept in step with each other. */
function colorField(brand, key, label) {
  const swatch = el('input', { className: 'ais-swatch', attrs: { type: 'color', value: brand[key] } });
  const text = el('input', { className: 'ais-input ais-hex', attrs: { type: 'text', maxlength: 7, spellcheck: 'false' } });
  text.value = brand[key];
  const sync = (v) => { brand[key] = v; text.value = v; swatch.value = v; };
  swatch.addEventListener('input', () => sync(swatch.value));
  text.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(text.value)) sync(text.value); });
  return {
    node: el('div', { className: 'ais-color' }, [
      el('span', { className: 'ais-label', text: label }),
      el('div', { className: 'ais-color-in' }, [swatch, text]),
    ]),
    set: sync,
  };
}

/**
 * An editable list of short strings, shown as removable chips with an add box.
 * Used for services and social links — both are things a site reader gets partly
 * right, so both need adding as well as removing.
 */
function chipList(list, { label, placeholder }) {
  const wrap = el('div', { className: 'ais-tags' });
  const draw = () => {
    wrap.textContent = '';
    list.forEach((value, i) => {
      const remove = el('button', {
        className: 'ais-chip-x', attrs: { type: 'button', 'aria-label': `Remove ${value}` }, text: '×',
      });
      remove.addEventListener('click', () => { list.splice(i, 1); draw(); });
      wrap.appendChild(el('span', { className: 'ais-chip ais-chip-edit' }, [
        el('span', { text: value }), remove,
      ]));
    });
  };
  draw();

  const add = el('input', { className: 'ais-input ais-add', attrs: { type: 'text', placeholder, maxlength: 80 } });
  // A visible button beside the box. Enter alone worked, but nothing on screen
  // said so, and an affordance nobody can see is not an affordance.
  const addBtn = el('button', { className: 'ais-btn ais-addbtn', attrs: { type: 'button' }, text: 'Add' });
  const commit = () => {
    const v = add.value.trim();
    if (!v || list.includes(v)) { add.value = ''; return; }
    list.push(v);
    add.value = '';
    draw();
    add.focus();
  };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  addBtn.addEventListener('click', commit);

  return el('div', { className: 'ais-bgroup' }, [
    el('span', { className: 'ais-label', text: label }),
    wrap,
    el('div', { className: 'ais-addrow' }, [add, addBtn]),
  ]);
}

export async function render(root, ctx) {
  const brand = emptyBrand();

  const page = el('div', { className: 'ai-studio' });
  root.appendChild(page);

  page.appendChild(el('header', { className: 'ais-head' }, [
    el('div', { className: 'ais-brand' }, [
      el('span', { className: 'ais-dot' }),
      el('h1', { text: 'AI Studio' }),
      el('span', { className: 'ais-tag mono', text: 'read your site, then let Claude write the week' }),
    ]),
    el('p', { className: 'ais-sub', text: 'Enter your website. Everything below comes from it, and everything is yours to correct. Nothing is published here.' }),
  ]));

  // --- the analyze bar -----------------------------------------------------
  const urlIn = el('input', {
    className: 'ais-input ais-url',
    attrs: { type: 'text', placeholder: 'Enter your website (e.g. yourbusiness.com)', spellcheck: 'false' },
  });
  const analyzeBtn = el('button', { className: 'ais-btn ais-analyze', attrs: { type: 'button' }, text: 'Analyze' });
  page.appendChild(el('div', { className: 'ais-urlbar' }, [
    el('div', { className: 'ais-urlrow' }, [urlIn, analyzeBtn]),
  ]));

  // --- the brand editor ----------------------------------------------------
  const card = el('section', { className: 'ais-brandcard', attrs: { hidden: true } });
  page.appendChild(card);

  const emptyState = el('div', { className: 'ais-empty' }, [
    el('p', { text: 'Your brand will appear here.' }),
    el('p', { className: 'ais-hint', text: 'Enter your website above and press Analyze. Cyflow reads the site and fills in your logo, colours, fonts, services and contact details — then you correct anything it got wrong.' }),
  ]);
  page.appendChild(emptyState);

  function drawCard() {
    card.textContent = '';
    card.hidden = false;
    emptyState.hidden = true;

    // Identity: the logo is editable like everything else — a reader picks the
    // wrong image often enough that a fixed one would be a permanent mistake.
    const preview = el('img', { className: 'ais-logo', attrs: { alt: 'Logo preview', loading: 'lazy' } });
    const placeholder = el('div', { className: 'ais-logo ais-logo-none', text: (brand.businessName || '?').slice(0, 1).toUpperCase() });
    const logoIn = el('input', { className: 'ais-input', attrs: { type: 'text', placeholder: 'https://…/logo.png', spellcheck: 'false' } });
    logoIn.value = brand.logoUrl || '';
    const showLogo = () => {
      const has = Boolean(brand.logoUrl);
      preview.hidden = !has;
      placeholder.hidden = has;
      if (has) preview.setAttribute('src', brand.logoUrl);
    };
    logoIn.addEventListener('input', () => { brand.logoUrl = logoIn.value.trim(); showLogo(); });
    showLogo();

    /*
     * Upload, as well as a URL.
     *
     * A reader finds the wrong mark often enough — and plenty of businesses have
     * a better logo file than anything on their site — that requiring a public
     * URL would leave some owners unable to give their own logo at all. The file
     * goes through the media library, which validates the bytes and returns a
     * stable address.
     */
    const picker = el('input', { className: 'ais-file', attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp' } });
    const uploadBtn = el('button', { className: 'ais-btn ais-secondary', attrs: { type: 'button' }, text: 'Upload a logo' });
    uploadBtn.addEventListener('click', () => picker.click());
    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading…';
      const form = new FormData();
      form.append('image', file);
      const res = await api.apiRequest('/api/media', { method: 'POST', body: form });
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload a logo';
      picker.value = '';
      if (!res.ok) { toast(api.errorMessage(res, 'That logo could not be uploaded.'), 'err'); return; }
      const asset = api.payload(res)?.media || api.payload(res);
      const url = asset?.url;
      if (!url) { toast('The upload did not return an image.', 'err'); return; }
      brand.logoUrl = url;
      brand.logoValidated = true;
      logoIn.value = url;
      showLogo();
      toast('Logo uploaded', 'ok');
    });

    card.appendChild(el('div', { className: 'ais-brandhead' }, [
      el('div', { className: 'ais-logowrap' }, [preview, placeholder]),
      el('div', { className: 'ais-logofield' }, [
        el('span', { className: 'ais-label', text: 'Logo' }),
        logoIn,
        el('div', { className: 'ais-logoactions' }, [uploadBtn, picker]),
        brand.logoUrl && !brand.logoValidated
          ? el('span', { className: 'ais-hint', text: 'Found on your site but not verified. Check it looks right.' })
          : null,
      ].filter(Boolean)),
    ]));

    const primary = colorField(brand, 'primary', 'Primary');
    const secondary = colorField(brand, 'secondary', 'Secondary');
    const accent = colorField(brand, 'accent', 'Accent');

    const swatches = brand.colorCandidates.length
      ? el('div', { className: 'ais-bgroup' }, [
        el('span', { className: 'ais-label', text: 'Other colours found on your site' }),
        el('div', { className: 'ais-swatches' }, brand.colorCandidates.map((c) => {
          const chip = el('button', { className: 'ais-sw', attrs: { type: 'button', title: `Use ${c} as the accent`, style: `background:${c}` } });
          chip.addEventListener('click', () => { accent.set(c); toast(`Accent set to ${c}`, 'ok'); });
          return chip;
        })),
        el('span', { className: 'ais-hint', text: 'Click any colour to make it the accent.' }),
      ])
      : null;

    card.appendChild(el('div', { className: 'ais-brandbody' }, [
      el('div', { className: 'ais-fieldgrid' }, [
        field(brand, 'businessName', 'Business name', { placeholder: 'What you are called' }),
        field(brand, 'industry', 'Industry', { placeholder: 'e.g. Brick pointing contractor' }),
      ]),
      field(brand, 'description', 'What the business does', { area: true, placeholder: 'A sentence or two about the business.' }),

      el('div', { className: 'ais-colors' }, [primary.node, secondary.node, accent.node]),
      swatches,

      el('div', { className: 'ais-fieldgrid' }, [
        field(brand, 'headingFont', 'Heading font', { placeholder: 'e.g. Playfair Display' }),
        field(brand, 'bodyFont', 'Body font', { placeholder: 'e.g. Inter' }),
      ]),

      chipList(brand.services, { label: 'Services', placeholder: 'Add a service' }),

      el('div', { className: 'ais-fieldgrid' }, [
        field(brand, 'phone', 'Phone'),
        field(brand, 'email', 'Email'),
        field(brand, 'websiteUrl', 'Website'),
        field(brand, 'address', 'Address'),
        field(brand, 'city', 'City'),
        field(brand, 'region', 'Region / state'),
        field(brand, 'postalCode', 'Postcode'),
        field(brand, 'country', 'Country'),
      ]),

      chipList(brand.socials, { label: 'Social profiles', placeholder: 'Add a profile URL' }),

      /*
       * The business's own photographs.
       *
       * This is the difference between a poster that looks like their post and
       * one that looks like a template. Every picture found is offered, selected
       * by default, and any that does not belong on a poster is one click from
       * being left out. They load lazily — a dozen full-size site photographs
       * would otherwise hold up the panel they sit in.
       */
      /*
       * The library opens; it does not sprawl.
       *
       * A site with thirty pictures pushed every other field off the screen, and
       * the panel is meant to be about the business, not a contact sheet. So it
       * collapses to one row — a thumbnail stack, the count, and what is
       * selected — and the whole library opens over the page when asked.
       */
      brand.images.length ? (() => {
        const summary = el('span', { className: 'ais-libcount' });
        const closeBtn = el('button', { className: 'ais-linkbtn', attrs: { type: 'button' }, text: 'Done' });
        const count = el('span', { className: 'ais-hint' });
        const setCount = () => {
          const on = brand.images.filter((i) => i.chosen).length;
          count.textContent = `${on} of ${brand.images.length} selected for your posters. Click any picture to include or leave it out.`;
          if (summary) summary.textContent = `${brand.images.length} images found · ${on} selected`;
        };
        const tiles = brand.images.map((img) => {
          const tile = el('button', {
            className: `ais-photo${img.chosen ? ' is-on' : ''}`,
            attrs: { type: 'button', title: `${img.alt || img.url}${img.kind !== 'photo' ? ` (${img.kind})` : ''}` },
          }, [
            el('img', { attrs: { src: img.url, alt: img.alt || '', loading: 'lazy', decoding: 'async' } }),
            el('span', { className: 'ais-photo-tick', text: '✓' }),
            // A logo or an icon is labelled so it is obvious why it starts off.
            img.kind !== 'photo' ? el('span', { className: 'ais-photo-kind', text: img.kind }) : null,
          ].filter(Boolean));
          tile.addEventListener('click', () => {
            img.chosen = !img.chosen;
            tile.classList.toggle('is-on', img.chosen);
            setCount();
          });
          return tile;
        });
        setCount();

        const all = el('button', { className: 'ais-linkbtn', attrs: { type: 'button' }, text: 'Select all' });
        const none = el('button', { className: 'ais-linkbtn', attrs: { type: 'button' }, text: 'Select none' });
        const setAll = (on) => {
          brand.images.forEach((img, i) => { img.chosen = on; tiles[i].classList.toggle('is-on', on); });
          setCount();
        };
        all.addEventListener('click', () => setAll(true));
        none.addEventListener('click', () => setAll(false));

        // --- the sheet the library opens into -----------------------------
        const sheet = el('div', { className: 'ais-sheet', attrs: { hidden: true, role: 'dialog', 'aria-label': 'Image library' } }, [
          el('div', { className: 'ais-sheet-scrim' }),
          el('div', { className: 'ais-sheet-body' }, [
            el('div', { className: 'ais-imghead' }, [
              el('span', { className: 'ais-label', text: `Image library — everything found on your site (${brand.images.length})` }),
              el('div', { className: 'ais-imgactions' }, [all, none, closeBtn]),
            ]),
            el('div', { className: 'ais-photos' }, tiles),
            count,
          ]),
        ]);
        const setOpen = (open) => {
          sheet.hidden = !open;
          document.body.style.overflow = open ? 'hidden' : '';
        };
        closeBtn.addEventListener('click', () => setOpen(false));
        sheet.querySelector('.ais-sheet-scrim').addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) setOpen(false); });

        // --- the collapsed row that opens it ------------------------------
        const openBtn = el('button', { className: 'ais-libbtn', attrs: { type: 'button' } }, [
          el('span', { className: 'ais-libicon', attrs: { 'aria-hidden': 'true' } }, [
            // Three stacked frames: a library, not a single picture.
            el('span', {}), el('span', {}), el('span', {}),
          ]),
          el('span', { className: 'ais-libtext' }, [
            el('span', { className: 'ais-liblabel', text: 'Image library' }),
            summary,
          ]),
          el('span', { className: 'ais-libpeek' }, brand.images.slice(0, 4).map((img) => el('img', {
            attrs: { src: img.url, alt: '', loading: 'lazy', decoding: 'async' },
          }))),
          el('span', { className: 'ais-libopen', text: 'Open' }),
        ]);
        openBtn.addEventListener('click', () => setOpen(true));
        setCount();

        return el('div', { className: 'ais-bgroup' }, [openBtn, sheet]);
      })() : el('div', { className: 'ais-bgroup' }, [
        el('span', { className: 'ais-label', text: 'Image library' }),
        el('span', { className: 'ais-hint', text: 'No images were found on this site. Posters will be built from your colours and type.' }),
      ]),
    ].filter(Boolean)));

    card.appendChild(nextBar);
  }

  // --- what happens next ---------------------------------------------------
  const nextBtn = el('button', { className: 'ais-btn ais-next', attrs: { type: 'button' }, text: 'Next: generate a week of posts' });
  const nextBar = el('div', { className: 'ais-nextbar' }, [
    el('p', { className: 'ais-hint', text: 'Claude decides what each post should say and how it should look. You review the week before anything is scheduled.' }),
    nextBtn,
  ]);
  nextBtn.addEventListener('click', () => {
    if (!brand.businessName.trim()) { toast('Add your business name first.', 'warn'); return; }
    toast('The weekly generator is the next step being built.', 'info');
  });

  // --- analyze -------------------------------------------------------------
  let analyzing = false;
  async function analyze() {
    const url = urlIn.value.trim();
    if (!url || analyzing) return;
    analyzing = true;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Reading…';

    const res = await api.apiRequest('/api/ai-studio/analyze', { method: 'POST', body: { url } });

    analyzing = false;
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze';

    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) { toast(api.errorMessage(res, 'That website could not be read.'), 'err'); return; }

    const data = api.payload(res) || {};
    const b = data.brand || {};
    const c = b.contact || {};

    /*
     * The read REPLACES the panel rather than merging into it.
     *
     * Merging left the previous site's industry sitting under this site's name —
     * two businesses in one form, and no way to tell which field belonged to
     * which. What this site did not say is shown empty, which is honest and
     * one click from being filled in by hand.
     */
    Object.assign(brand, emptyBrand(), {
      businessName: b.businessName || '',
      industry: b.industry || '',
      description: b.description || '',
      logoUrl: b.logoUrl || '',
      logoValidated: Boolean(b.logoValidated),
      headingFont: b.fonts?.heading || '',
      bodyFont: b.fonts?.body || '',
      primary: b.colors?.primary || '#111827',
      secondary: b.colors?.secondary || '#6b7280',
      accent: b.colors?.accent || '#2563eb',
      colorCandidates: Array.isArray(b.colorCandidates) ? b.colorCandidates : [],
      services: Array.isArray(b.services) ? [...b.services] : [],
      // The server decides what starts ticked (Claude's judgement, or the
      // picture's own kind). Everything found is shown either way.
      images: (Array.isArray(b.images) ? b.images : []).map((im) => ({ ...im, chosen: im.chosen !== false })),
      socials: Array.isArray(b.socialLinks)
        ? b.socialLinks.map((s) => (typeof s === 'string' ? s : s?.url || s?.platform)).filter(Boolean)
        : Object.values(b.socialLinks || {}).filter(Boolean),
      phone: c.phone || '', email: c.email || '', address: c.address || '',
      city: c.city || '', region: c.region || '', postalCode: c.postalCode || '',
      country: c.country || '', websiteUrl: c.websiteUrl || data.sourceUrl || '',
    });

    drawCard();

    if (data.warnings?.length) {
      card.appendChild(el('div', { className: 'ais-warn' }, [
        el('span', { className: 'ais-label', text: 'What could not be read' }),
        el('ul', { className: 'ais-warnlist' }, data.warnings.map((w) => el('li', { text: String(w) }))),
      ]));
    }
    toast('Brand read from your website', 'ok');
  }

  analyzeBtn.addEventListener('click', analyze);
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
}

export default { render };
