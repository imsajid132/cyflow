/**
 * Shared HTML fragments used across layouts.
 *
 * Every fragment returns '' when its content is absent, so a layout composed
 * from them stays balanced whether a business supplies a full brand kit or only
 * a headline. Optional modules are omitted, never rendered empty.
 *
 * All text arriving here is already escaped by the orchestrator.
 */

/** Join class names without leaving empty slots behind. */
const cls = (...names) => names.filter(Boolean).join(' ');

/** Logo image, or nothing. `src` must already be a validated https URL. */
export function logo(src, { align = 'left', className = '' } = {}) {
  if (!src) return '';
  return `<img class="${cls('logo', align === 'right' && 'logo-right', className)}" src="${src}" alt="">`;
}

export function eyebrow(text, className = '') {
  return text ? `<span class="${cls('eyebrow', className)}">${text}</span>` : '';
}

export function cta(text, variant = '') {
  return text ? `<span class="${cls('cta', variant)}">${text}</span>` : '';
}

export function tag(text) {
  return text ? `<span class="tag">${text}</span>` : '';
}

export function subheadline(text) {
  return text ? `<p class="subheadline">${text}</p>` : '';
}

/**
 * Footer lockup: brand name, then contact details separated by accent dots.
 * Renders only the parts that exist, and nothing at all when none do.
 */
export function footerLockup({ brandName, website, phone }, className = '') {
  const bits = [];
  if (brandName) bits.push(`<span class="brandname">${brandName}</span>`);
  if (website) bits.push(`<span>${website}</span>`);
  if (phone) bits.push(`<span>${phone}</span>`);
  if (!bits.length) return '';
  const joined = bits.join('<span class="footer-dot"></span>');
  return `<div class="${cls('footer', className)}">${joined}</div>`;
}

/** Contact details only — for layouts that place the brand name elsewhere. */
export function contactLockup({ website, phone }, className = '') {
  const bits = [];
  if (website) bits.push(`<span>${website}</span>`);
  if (phone) bits.push(`<span>${phone}</span>`);
  if (!bits.length) return '';
  return `<div class="${cls('footer', className)}">${bits.join('<span class="footer-dot"></span>')}</div>`;
}

export default { logo, eyebrow, cta, tag, subheadline, footerLockup, contactLockup };
