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
  /*
   * The week.
   *
   * Planning is one call and comes back in the response, so seven ideas appear
   * at once — the difference between "something is happening" and a spinner. The
   * posters are durable jobs, so this screen polls rather than waits, and the
   * page can be closed without stopping the week.
   */
  const weekView = el('section', { className: 'ais-week', attrs: { hidden: true } });
  page.appendChild(weekView);

  let polling = null;

  function drawWeek(week) {
    weekView.textContent = '';
    weekView.hidden = false;

    const failed = Number(week.failed || 0);
    const done = week.ready + failed >= week.total;
    // "Finished with two failures" is not "ready", and must not read as ready.
    const title = done && failed ? 'Your week finished with some gaps' : done ? 'Your week is ready to review' : 'Building your week';
    const sub = done && failed
      ? `${week.ready} of ${week.total} posts were built. The rest are marked below with what went wrong.`
      : done
        ? 'Check each post below. Nothing is scheduled or published until you say so.'
        : 'Claude has planned the week. The posters are being designed now — you can close this page and come back.';

    /*
     * A week that finished with gaps offers the way out from HERE, next to the
     * failure. The button that starts a week already exists further up the page,
     * but a user reading "0 of 7 were built" should not have to work out that
     * scrolling back to a button labelled "Next" is what fixes it.
     */
    const head = el('div', { className: 'ais-weekhead' }, [
      el('div', {}, [
        el('h2', { className: 'ais-brandname', text: title }),
        el('p', { className: 'ais-hint', text: sub }),
      ]),
      el('div', { className: 'ais-weekcount' }, [
        el('span', { className: 'ais-weeknum', text: `${week.ready} / ${week.total}` }),
        el('span', { className: 'ais-hint', text: 'posts built' }),
      ]),
    ]);
    if (done && failed) {
      const again = el('button', {
        className: 'ais-btn ais-again', attrs: { type: 'button' },
        text: failed >= week.total ? 'Generate a new week' : 'Generate a new week instead',
      });
      again.addEventListener('click', startWeek);
      head.appendChild(again);
    }
    weekView.appendChild(head);

    weekView.appendChild(el('div', { className: 'ais-bar' }, [
      el('span', { className: 'ais-bar-fill', attrs: { style: `width:${Math.round((week.ready / week.total) * 100)}%` } }),
    ]));

    const byDay = new Map(week.posts.map((p) => [p.day, p]));
    // `days` carries each day's state (built / queued / building / retrying /
    // failed). The plain plan is the fallback for an older response.
    const rows = Array.isArray(week.days) && week.days.length ? week.days : week.plan;
    weekView.appendChild(el('div', { className: 'ais-days' }, rows.map((entry) => {
      const post = byDay.get(entry.day);
      const head = el('div', { className: 'ais-dayhead' }, [
        el('span', { className: 'ais-daynum', text: `Day ${entry.day}` }),
        entry.job ? el('span', { className: 'ais-chip', text: entry.job }) : null,
        entry.service ? el('span', { className: 'ais-chip', text: entry.service }) : null,
      ].filter(Boolean));

      if (!post) {
        /*
         * A day with no post yet says WHICH kind of "not yet" it is. Waiting and
         * "gave up after three tries" looked identical — a spinner that would
         * never stop — and one of them needs the user to do something.
         */
        if (entry.state === 'failed') {
          return el('article', { className: 'ais-day is-failed' }, [
            head,
            el('p', { className: 'ais-dayangle', text: entry.angle }),
            el('div', { className: 'ais-dayfail' }, [
              el('span', { className: 'ais-cap-label', text: 'This post could not be built' }),
              el('p', { className: 'ais-hint', text: entry.error || 'The AI could not be reached.' }),
              entry.attempts ? el('p', { className: 'ais-hint', text: `Tried ${entry.attempts} times.` }) : null,
            ].filter(Boolean)),
          ]);
        }
        const waitText = entry.state === 'retrying'
          ? `Trying again${entry.attempts ? ` (attempt ${entry.attempts + 1})` : ''}…`
          : entry.state === 'queued'
            ? 'Waiting its turn…'
            : 'Designing the poster and writing the copy…';
        return el('article', { className: 'ais-day is-waiting' }, [
          head,
          el('p', { className: 'ais-dayangle', text: entry.angle }),
          el('div', { className: 'ais-daywait' }, [
            el('span', { className: 'ais-spinner ais-spinner-sm' }),
            el('span', { className: 'ais-hint', text: waitText }),
          ]),
        ]);
      }

      /*
       * The two things a reviewer can ask for again, each under the thing it
       * changes. They are separate because the dissatisfactions are separate:
       * not liking the picture is not a request to rewrite the words.
       *
       * The work is a durable job, so the button's job is to say it was heard.
       * The result arrives through the poll that is already running.
       */
      const redoing = post.regenerating;
      const redoBtn = (kind, label) => {
        const busy = redoing === kind;
        const btn = el('button', {
          className: `ais-btn ais-redo${busy ? ' is-busy' : ''}`,
          attrs: { type: 'button', ...(busy ? { disabled: 'disabled' } : {}) },
          text: busy ? (kind === 'poster' ? 'Designing a new poster…' : 'Writing new copy…') : label,
        });
        btn.addEventListener('click', () => regenerate(week.runId, post.day, kind, btn));
        return btn;
      };

      const poster = post.posterUrl
        ? el('img', { className: 'ais-dayposter', attrs: { src: post.posterUrl, alt: post.headline || `Day ${post.day} poster`, loading: 'lazy', decoding: 'async' } })
        : el('div', { className: 'ais-dayposter ais-dayposter-none' }, [
          el('span', { className: 'ais-hint', text: post.imageError || 'The poster could not be made for this post.' }),
        ]);

      const caption = (label, text) => (text ? el('div', { className: 'ais-cap' }, [
        el('div', { className: 'ais-cap-head' }, [el('span', { className: 'ais-cap-label', text: label })]),
        el('p', { className: 'ais-cap-text', text }),
      ]) : null);

      return el('article', { className: 'ais-day' }, [
        head,
        el('p', { className: 'ais-dayangle', text: post.angle || entry.angle }),
        el('div', { className: 'ais-daybody' }, [
          el('div', { className: 'ais-daypost' }, [
            poster,
            redoBtn('poster', 'Regenerate poster'),
          ]),
          el('div', { className: 'ais-daycaps' }, [
            caption('Facebook', post.captions.facebook),
            caption('Instagram', post.captions.instagram),
            caption('Threads', post.captions.threads),
            post.hashtags?.length
              ? el('div', { className: 'ais-tags' }, post.hashtags.map((h) => el('span', { className: 'ais-chip', text: h })))
              : null,
            redoBtn('caption', 'Regenerate captions'),
          ].filter(Boolean)),
        ]),
      ]);
    })));

    /*
     * The last step, and only once there is a week to send.
     *
     * The product is strict about what belongs here: the accounts the user has
     * already connected, a timezone, a time. No audience settings, no per-post
     * scheduling, nothing to configure. One button.
     */
    if (done && week.ready > 0) weekView.appendChild(activateBar(week));

    /*
     * Stop polling when the week is finished AND nothing is being redone. The
     * second half matters: a regeneration is asked for AFTER the week finishes,
     * so a poll that stopped at "done" would leave the new poster sitting in
     * storage with the old one still on screen.
     */
    const busy = week.posts?.some((p) => p.regenerating);
    if (done && !busy && polling) { clearInterval(polling); polling = null; }
    if ((!done || busy) && !polling && week.runId) {
      polling = setInterval(() => pollWeek(week.runId), 5000);
    }
  }

  /*
   * ---- step 4, 5 and 6: accounts, timezone, activate -----------------------
   *
   * Fetched once and kept: the list does not change while someone is looking at
   * it, and re-fetching on every poll would flicker the ticks they just made.
   */
  let accountsCache = null;
  const chosenAccounts = new Set();

  async function loadAccounts() {
    if (accountsCache) return accountsCache;
    const res = await api.apiRequest('/api/ai-studio/accounts');
    accountsCache = res.ok ? (api.payload(res)?.accounts || []) : [];
    // Everything usable starts ticked: someone who connected an account meant
    // to post to it, and unticking is easier than hunting for the one they want.
    accountsCache.forEach((a) => { if (a.connected) chosenAccounts.add(a.id); });
    return accountsCache;
  }

  /** Every timezone this browser knows, so nobody has to find theirs in a short list. */
  function allTimezones() {
    const supported = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    // The user's own zone first: it is the answer nine times out of ten.
    return supported.length ? [here, ...supported.filter((z) => z !== here)] : [here, 'UTC'];
  }

  function activateBar(week) {
    const bar = el('section', { className: 'ais-activate' });
    bar.appendChild(el('h3', { className: 'ais-brandname', text: 'Send this week' }));
    bar.appendChild(el('p', {
      className: 'ais-hint',
      text: 'Choose where it goes and when. One post goes out straight away; the rest follow one a day, and it keeps going without this page being open.',
    }));

    const list = el('div', { className: 'ais-accounts' }, [
      el('span', { className: 'ais-hint', text: 'Loading your accounts…' }),
    ]);
    bar.appendChild(list);

    const tzSelect = el('select', { className: 'ais-input ais-select' });
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    for (const zone of allTimezones()) {
      tzSelect.appendChild(el('option', { attrs: { value: zone, ...(zone === here ? { selected: 'selected' } : {}) }, text: zone }));
    }
    const timeInput = el('input', { className: 'ais-input ais-time', attrs: { type: 'time', value: '09:00' } });

    bar.appendChild(el('div', { className: 'ais-when' }, [
      el('label', { className: 'ais-row' }, [el('span', { className: 'ais-label', text: 'Timezone' }), tzSelect]),
      el('label', { className: 'ais-row' }, [el('span', { className: 'ais-label', text: 'Time each day' }), timeInput]),
    ]));

    const go = el('button', { className: 'ais-btn ais-go', attrs: { type: 'button' }, text: 'Activate this week' });
    const note = el('p', { className: 'ais-hint ais-gonote' });
    bar.appendChild(el('div', { className: 'ais-gorow' }, [go, note]));

    loadAccounts().then((accounts) => {
      list.textContent = '';
      if (!accounts.length) {
        list.appendChild(el('p', { className: 'ais-hint', text: 'No accounts are connected yet. Connect one on the Connections page, then come back.' }));
        go.disabled = true;
        return;
      }
      for (const a of accounts) {
        const box = el('input', {
          className: 'ais-check',
          attrs: { type: 'checkbox', ...(chosenAccounts.has(a.id) ? { checked: 'checked' } : {}), ...(a.connected ? {} : { disabled: 'disabled' }) },
        });
        box.addEventListener('change', () => {
          if (box.checked) chosenAccounts.add(a.id); else chosenAccounts.delete(a.id);
        });
        list.appendChild(el('label', { className: `ais-account${a.connected ? '' : ' is-off'}` }, [
          box,
          el('span', { className: 'ais-acct-name', text: a.displayName }),
          el('span', { className: 'ais-chip', text: a.platform }),
          // An account that cannot be posted to says so, rather than going
          // missing from a list with no explanation.
          a.connected ? null : el('span', { className: 'ais-hint', text: 'needs reconnecting' }),
        ].filter(Boolean)));
      }
    });

    go.addEventListener('click', async () => {
      if (!chosenAccounts.size) { toast('Choose at least one account first.', 'warn'); return; }
      go.disabled = true;
      go.textContent = 'Scheduling…';

      const res = await api.apiRequest(`/api/ai-studio/week/${encodeURIComponent(week.runId)}/activate`, {
        method: 'POST',
        body: { accountIds: [...chosenAccounts], timezone: tzSelect.value, dailyTime: timeInput.value },
      });

      go.disabled = false;
      go.textContent = 'Activate this week';

      if (res.unauthorized) { ctx.navigate('/login'); return; }
      if (!res.ok) { toast(api.errorMessage(res, 'This week could not be scheduled.'), 'err'); return; }

      const out = api.payload(res) || {};
      /*
       * Said plainly, because it is the difference between "your post is live"
       * and "your post is scheduled". Live publishing is off, and a screen that
       * implied otherwise would be lying to someone about their own business.
       */
      note.textContent = out.liveEnabled
        ? `${out.queued} posts scheduled. The first goes out in about two minutes.`
        : `${out.queued} posts scheduled, one a day at ${out.dailyTime} (${out.timezone}). Sending to your accounts is still switched off, so nothing has been posted yet.`;
      toast('Your week is scheduled.', 'ok');
    });

    return bar;
  }

  /** Ask for one piece of one day again. The poll shows the result. */
  async function regenerate(runId, day, kind, btn) {
    if (!runId || btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = kind === 'poster' ? 'Designing a new poster…' : 'Writing new copy…';

    const res = await api.apiRequest(
      `/api/ai-studio/week/${encodeURIComponent(runId)}/day/${day}/${kind}`,
      { method: 'POST', body: {} },
    );

    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = original;
      toast(api.errorMessage(res, 'That could not be regenerated.'), 'err');
      return;
    }

    const out = api.payload(res) || {};
    toast(out.message || 'Working on it.', 'ok');
    // The button stays disabled: the next poll re-renders the card from the
    // server, which is the only thing that knows when the work is actually done.
    if (!polling) polling = setInterval(() => pollWeek(runId), 5000);
  }

  async function pollWeek(runId) {
    const res = await api.apiRequest(`/api/ai-studio/week/${encodeURIComponent(runId)}`);
    if (!res.ok) return;
    const week = api.payload(res);
    if (week) drawWeek(week);
  }

  /*
   * Plan a week and start watching it build.
   *
   * One function, two ways in: the button under the brand, and the one offered
   * on a week that finished with gaps. A week that failed needs starting again
   * from where the user is LOOKING at the failure — sending them back up the
   * page to find the original button is asking them to work out that the two
   * buttons are the same thing.
   */
  let starting = false;
  async function startWeek() {
    if (starting) return;
    if (!brand.businessName.trim()) { toast('Add your business name first.', 'warn'); return; }

    starting = true;
    nextBtn.disabled = true;
    nextBtn.textContent = 'Planning your week…';

    const res = await api.apiRequest('/api/ai-studio/week', {
      method: 'POST',
      body: {
        ...brand,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
    });

    starting = false;
    nextBtn.disabled = false;
    nextBtn.textContent = 'Next: generate a week of posts';

    if (res.unauthorized) { ctx.navigate('/login'); return; }
    if (!res.ok) { toast(api.errorMessage(res, 'The week could not be planned.'), 'err'); return; }

    const out = api.payload(res) || {};
    drawWeek({ runId: out.runId, total: out.plan.length, ready: 0, plan: out.plan, posts: [] });
    weekView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Your week is planned. The posters are being built.', 'ok');

    if (polling) clearInterval(polling);
    polling = setInterval(() => pollWeek(out.runId), 5000);
  }
  nextBtn.addEventListener('click', startWeek);

  /*
   * ---- what survives the tab ----------------------------------------------
   *
   * Reading a site takes the better part of a minute and is then corrected by
   * hand, field by field. All of that used to live in one browser tab: a
   * refresh, a slept phone, a closed laptop, and it was an empty URL box again.
   * A week is worse — five to eight minutes of building, and the run id existed
   * only in the tab that started it, so a refresh abandoned posters that were
   * still being made.
   *
   * So the brand is kept on the server as it is edited, and the week is found by
   * asking rather than by remembering an id.
   */

  /** Server brand (nested, as analyze returns it) → the flat shape this screen edits. */
  function applyServerBrand(b, fallbackUrl) {
    const c = b.contact || {};
    /*
     * The read REPLACES the panel rather than merging into it.
     *
     * Merging left the previous site's industry sitting under this site's name —
     * two businesses in one form, and no way to tell which field belonged to
     * which. What this site did not say is shown empty, which is honest and one
     * click from being filled in by hand.
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
      country: c.country || '', websiteUrl: c.websiteUrl || fallbackUrl || '',
    });
  }

  /** The flat shape this screen edits → the nested one the server keeps. */
  function brandForServer() {
    return {
      businessName: brand.businessName,
      industry: brand.industry,
      description: brand.description,
      services: brand.services,
      logoUrl: brand.logoUrl,
      logoValidated: brand.logoValidated,
      fonts: { heading: brand.headingFont, body: brand.bodyFont },
      colors: { primary: brand.primary, secondary: brand.secondary, accent: brand.accent },
      colorCandidates: brand.colorCandidates,
      contact: {
        phone: brand.phone, email: brand.email, address: brand.address,
        city: brand.city, region: brand.region, postalCode: brand.postalCode,
        country: brand.country, websiteUrl: brand.websiteUrl,
      },
      // Chips are edited as a list; the server keeps them keyed so a link cannot
      // lose which network it belongs to.
      socialLinks: Object.fromEntries(brand.socials.map((url, i) => [`link${i + 1}`, url])),
      images: brand.images,
      sourceUrl: brand.websiteUrl,
    };
  }

  /*
   * Saved a beat after typing stops, not on every keystroke: a save per
   * character would be a request per character. Failures are silent on purpose —
   * this is a safety net, and a red toast every time a phone loses signal would
   * be noise about something the user did not ask for.
   */
  let saveTimer = null;
  function scheduleSave() {
    if (!brand.businessName && !brand.websiteUrl) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.apiRequest('/api/ai-studio/brand', { method: 'POST', body: { brand: brandForServer() } }).catch(() => {});
    }, 1200);
  }
  // One listener for the whole panel instead of a hook in every control: edits
  // bubble, and a control added later is covered without being told to be.
  page.addEventListener('input', scheduleSave);
  page.addEventListener('change', scheduleSave);
  page.addEventListener('click', scheduleSave);

  /** Put back whatever this user had: the brand they corrected, the week they started. */
  async function restore() {
    const res = await api.apiRequest('/api/ai-studio/session');
    if (!res.ok) return;
    const data = api.payload(res) || {};

    if (data.brand) {
      applyServerBrand(data.brand, data.brand.sourceUrl);
      if (!urlIn.value) urlIn.value = brand.websiteUrl || data.brand.sourceUrl || '';
      drawCard();
    }

    // drawWeek decides for itself whether there is anything left to watch, so a
    // week still building picks its polling back up where the old tab left off.
    if (data.week?.runId) drawWeek(data.week);
  }

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
    applyServerBrand(data.brand || {}, data.sourceUrl);
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

  // Last, so the page is fully built before anything is put back into it. A
  // failed restore leaves the empty studio, which is what it looked like before.
  await restore().catch(() => {});
}

export default { render };
