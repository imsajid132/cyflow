/**
 * Shared editable brand/business form.
 *
 * Used by onboarding step 2 (/onboarding/brand) and the Brand page (/brand).
 * Values arriving from website analysis are marked with an "extracted" badge so
 * the user always knows what was suggested vs. what they typed. Nothing is
 * saved until the user submits.
 */

import { el, field, badge } from '../ui.js';

const TONES = ['neutral', 'friendly', 'professional', 'playful', 'bold', 'informative'];

/** Chip list with add/remove. */
function chipList({ id, label, values, placeholder }) {
  const state = [...(values || [])];
  const chips = el('div', { className: 'chips', attrs: { id: `${id}-chips` } });
  const input = el('input', { className: 'input', attrs: { id: `${id}-input`, type: 'text', placeholder } });

  function paint() {
    chips.textContent = '';
    if (state.length === 0) {
      chips.appendChild(el('span', { className: 'hint', text: 'None yet.' }));
    }
    state.forEach((value, index) => {
      chips.appendChild(el('span', { className: 'chip' }, [
        el('span', { text: value }),
        el('button', {
          text: '✕',
          attrs: { type: 'button', 'aria-label': `Remove ${value}` },
          on: { click: () => { state.splice(index, 1); paint(); } },
        }),
      ]));
    });
  }
  function add() {
    const value = input.value.trim();
    if (!value) return;
    if (!state.some((s) => s.toLowerCase() === value.toLowerCase())) state.push(value);
    input.value = '';
    paint();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  paint();

  const node = el('div', { className: 'field' }, [
    el('label', { className: 'label', text: label, attrs: { for: `${id}-input` } }),
    chips,
    el('div', { className: 'row' }, [
      input,
      el('button', { className: 'btn btn-secondary btn-sm', text: 'Add', attrs: { type: 'button' }, on: { click: add } }),
    ]),
  ]);
  return { node, get: () => [...state] };
}

/*
 * A colour input needs SOME value, and that value must not be a brand colour
 * nobody chose. It used to default to #4f46e5: the app's old indigo, seeded into
 * the customer's palette on the page where they define their brand, from where
 * it would follow them onto every generated post.
 *
 * A neutral near-black is the honest default. It is not a hue the business did
 * not pick, it is the absence of one, and it matches what the creative engine
 * already treats as always-permissible ink.
 */
const NEUTRAL_SWATCH = '#111827';

function colorField({ id, label, value, extracted }) {
  const picker = el('input', { attrs: { type: 'color', id: `${id}-picker`, value: value || NEUTRAL_SWATCH, 'aria-label': `${label} picker` } });
  const text = el('input', { className: 'input', attrs: { id, type: 'text', placeholder: NEUTRAL_SWATCH, maxlength: 7 } });
  text.value = value || '';
  picker.addEventListener('input', () => { text.value = picker.value; });
  text.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value; });
  return el('div', { className: 'field' }, [
    el('div', { className: 'row', attrs: { style: 'gap:.4rem' } }, [
      el('label', { className: 'label', text: label, attrs: { for: id } }),
      extracted ? badge('extracted', 'info') : null,
    ]),
    el('div', { className: 'color-row' }, [picker, text]),
    el('p', { className: 'field-error', attrs: { id: `${id}-error`, hidden: true } }),
  ]);
}

function labelled(labelText, extracted, node) {
  if (!extracted) return node;
  const label = node.querySelector('.label');
  if (label) {
    const wrap = el('div', { className: 'row', attrs: { style: 'gap:.4rem' } }, [
      el('span', { className: 'label', text: labelText }),
      badge('extracted', 'info'),
    ]);
    label.replaceWith(wrap);
  }
  return node;
}

/**
 * @param {{ profile?: object, suggestions?: object }} input
 * @returns {{ node: HTMLElement, collect: Function, refreshPreview: Function }}
 */
export function buildBrandForm({ profile = {}, suggestions = null } = {}) {
  const v = (key) => {
    const fromProfile = profile?.[key];
    if (fromProfile != null && fromProfile !== '') return fromProfile;
    return suggestions?.[key] ?? '';
  };
  const isExtracted = (key) =>
    Boolean(suggestions && suggestions[key] && (profile?.[key] == null || profile?.[key] === ''));

  const logoUrl = v('logoUrl');
  const faviconUrl = v('faviconUrl');

  /*
   * The business logo slot must NEVER fall back to the Cyflow mark.
   *
   * It used to show /assets/favicon.svg when a business had no logo, which put
   * the Cyflow application logo in the place reserved for the CUSTOMER's brand,
   * on the very page where they review that brand. The two brands are separate:
   * Cyflow's mark is app chrome, the business's logo is content.
   *
   * With no logo there is nothing of theirs to show, so the slot shows an empty
   * state and says so, rather than borrowing somebody else's mark.
   */
  const LOGO_EMPTY = 'is-empty';
  const logoImg = el('img', {
    className: 'logo-preview',
    attrs: { alt: 'Business logo preview', id: 'logo-preview' },
  });
  const logoEmpty = el('div', {
    className: 'logo-preview-empty',
    text: 'No logo yet',
    attrs: { id: 'logo-preview-empty' },
  });
  /*
   * The <img> is REMOVED when there is no logo, not merely hidden.
   *
   * A hidden <img> with no src is still an image element the browser reports as
   * broken (complete, naturalWidth 0), which is both untidy and a false
   * positive for any tool auditing for broken images. Either there is a picture
   * or there is an empty state; there is never a picture element with nothing
   * in it.
   */
  const logoSlot = el('div', { className: 'logo-slot' }, [logoEmpty]);
  const showLogo = (url) => {
    const usable = typeof url === 'string' && /^https:\/\//.test(url.trim());
    if (usable) {
      logoImg.src = url.trim();
      if (!logoImg.isConnected) logoSlot.prepend(logoImg);
      logoEmpty.hidden = true;
    } else {
      logoImg.remove();
      logoImg.removeAttribute('src');
      logoEmpty.hidden = false;
    }
  };
  showLogo(logoUrl);

  const logoField = field({ id: 'logoUrl', label: 'Logo URL', value: logoUrl, hint: 'Loaded from your own website. You can replace it with any https image URL.' });
  logoField.querySelector('#logoUrl').addEventListener('input', (e) => showLogo(e.target.value));

  const services = chipList({ id: 'services', label: 'Services', values: profile?.services?.length ? profile.services : suggestions?.services || [], placeholder: 'e.g. Roof Repair' });
  const locations = chipList({ id: 'locations', label: 'Locations', values: profile?.locations?.length ? profile.locations : suggestions?.locations || [], placeholder: 'e.g. Springfield' });

  const socialLinks = (profile?.socialLinks?.length ? profile.socialLinks : suggestions?.socialLinks || []);
  const socialNode = socialLinks.length
    ? el('div', { className: 'chips' }, socialLinks.map((s) => el('span', { className: 'chip', text: `${s.platform}` })))
    : el('p', { className: 'hint', text: 'No social profile links found.' });

  const node = el('div', { className: 'stack' }, [
    // Logo
    card2('Logo & favicon', [
      el('div', { className: 'grid grid-2' }, [
        el('div', { className: 'stack' }, [logoSlot, faviconUrl ? el('p', { className: 'hint', text: `Favicon: ${faviconUrl}` }) : null]),
        el('div', { className: 'stack' }, [
          logoField,
          field({ id: 'faviconUrl', label: 'Favicon URL', value: faviconUrl }),
        ]),
      ]),
    ]),
    // Identity
    card2('Business identity', [
      el('div', { className: 'grid grid-2' }, [
        labelled('Business name', isExtracted('businessName'), field({ id: 'businessName', label: 'Business name', value: v('businessName') })),
        labelled('Category', isExtracted('businessCategory'), field({ id: 'businessCategory', label: 'Category', value: v('businessCategory'), hint: 'e.g. Roofing Contractor' })),
        labelled('Website', isExtracted('websiteUrl'), field({ id: 'websiteUrl', label: 'Website', value: v('websiteUrl') })),
      ]),
      labelled('Description', isExtracted('businessDescription'), field({ id: 'businessDescription', label: 'Description', type: 'textarea', value: v('businessDescription') })),
    ]),
    // Contacts
    card2('Contact information', [
      el('div', { className: 'grid grid-2' }, [
        labelled('Phone', isExtracted('phone'), field({ id: 'phone', label: 'Phone', value: v('phone') })),
        labelled('Email', isExtracted('email'), field({ id: 'email', label: 'Email', type: 'email', value: v('email') })),
        labelled('Address', isExtracted('address'), field({ id: 'address', label: 'Address', value: v('address') })),
        labelled('City', isExtracted('city'), field({ id: 'city', label: 'City', value: v('city') })),
        field({ id: 'region', label: 'Region / State', value: v('region') }),
        field({ id: 'postalCode', label: 'Postal code', value: v('postalCode') }),
        field({ id: 'country', label: 'Country', value: v('country') }),
      ]),
    ]),
    // Services + locations
    card2('Services & locations', [services.node, locations.node, el('div', { className: 'field' }, [el('span', { className: 'label', text: 'Social profile links' }), socialNode])]),
    // Colors + fonts
    card2('Brand colours & fonts', [
      el('div', { className: 'grid grid-3' }, [
        colorField({ id: 'primaryColor', label: 'Primary', value: v('primaryColor'), extracted: isExtracted('primaryColor') }),
        colorField({ id: 'secondaryColor', label: 'Secondary', value: v('secondaryColor'), extracted: isExtracted('secondaryColor') }),
        colorField({ id: 'accentColor', label: 'Accent', value: v('accentColor'), extracted: isExtracted('accentColor') }),
      ]),
      el('div', { className: 'grid grid-2' }, [
        labelled('Heading font', isExtracted('headingFont'), field({ id: 'headingFont', label: 'Heading font', value: v('headingFont'), hint: 'Name only — font files are never downloaded.' })),
        labelled('Body font', isExtracted('bodyFont'), field({ id: 'bodyFont', label: 'Body font', value: v('bodyFont') })),
      ]),
    ]),
    // Defaults
    card2('Default content preferences', [
      el('div', { className: 'grid grid-3' }, [
        field({ id: 'defaultLanguage', label: 'Default language', value: v('defaultLanguage') || 'English' }),
        el('div', { className: 'field' }, [
          el('label', { className: 'label', text: 'Default tone', attrs: { for: 'defaultTone' } }),
          el('select', { className: 'select', attrs: { id: 'defaultTone' } },
            ['', ...TONES].map((t) => {
              const o = el('option', { text: t || '— none —', attrs: { value: t } });
              if (t === (v('defaultTone') || '')) o.selected = true;
              return o;
            }),
          ),
          el('p', { className: 'field-error', attrs: { id: 'defaultTone-error', hidden: true } }),
        ]),
        field({ id: 'defaultCallToAction', label: 'Default call to action', value: v('defaultCallToAction') }),
      ]),
    ]),
  ]);

  function collect() {
    const text = (id) => (document.getElementById(id)?.value ?? '').trim();
    const patch = {
      businessName: text('businessName'),
      businessCategory: text('businessCategory'),
      businessDescription: text('businessDescription'),
      phone: text('phone'),
      email: text('email'),
      address: text('address'),
      city: text('city'),
      region: text('region'),
      postalCode: text('postalCode'),
      country: text('country'),
      headingFont: text('headingFont'),
      bodyFont: text('bodyFont'),
      defaultLanguage: text('defaultLanguage'),
      defaultCallToAction: text('defaultCallToAction'),
      services: services.get(),
      locations: locations.get(),
    };
    for (const key of ['websiteUrl', 'logoUrl', 'faviconUrl']) {
      const value = text(key);
      patch[key] = value === '' ? null : value;
    }
    for (const key of ['primaryColor', 'secondaryColor', 'accentColor']) {
      const value = text(key);
      patch[key] = value === '' ? null : value;
    }
    const tone = text('defaultTone');
    patch.defaultTone = tone === '' ? null : tone;
    // Empty strings for plain text fields are fine; the API bounds them.
    return patch;
  }

  return { node, collect };
}

function card2(title, children) {
  return el('div', { className: 'card' }, [
    el('div', { className: 'card-head' }, [el('span', { className: 'card-title', text: title })]),
    el('div', { className: 'stack' }, children),
  ]);
}

export default { buildBrandForm };
