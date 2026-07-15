/**
 * Locally authored SVG icons.
 *
 * Every path here is a static constant written in this file — nothing comes
 * from a network response, an analyzed website, or user input. This is the only
 * place innerHTML is used, and only with these trusted constants.
 */

const PATHS = {
  dashboard: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z"/>',
  brand: '<path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/>',
  connections: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12 19"/>',
  create: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  integrations: '<path d="M14 7h5a2 2 0 012 2v5M10 17H5a2 2 0 01-2-2V10"/><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H1a2 2 0 110-4h.1A1.7 1.7 0 002.6 7a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 2.6V2a2 2 0 114 0v.1A1.7 1.7 0 0017 4.6a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H22a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};

/** Stroked line icon (24x24). */
export function icon(name, className = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = PATHS[name] || ''; // trusted local constant only
  return svg;
}

/** Brand-coloured provider marks (authored here — not fetched from providers). */
const PROVIDER_SVG = {
  meta: '<rect width="34" height="34" rx="8" fill="#1877F2"/><path d="M22.3 17.5l.5-3.3h-3.2v-2.2c0-.9.4-1.8 1.9-1.8h1.4V7.4s-1.3-.2-2.5-.2c-2.6 0-4.2 1.5-4.2 4.3v2.7h-2.9v3.3h2.9v8h3.5v-8z" fill="#fff"/>',
  instagram: '<defs><linearGradient id="igg" x1="0" y1="34" x2="34" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".65" stop-color="#D62976"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect width="34" height="34" rx="8" fill="url(#igg)"/><rect x="9" y="9" width="16" height="16" rx="5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="22" cy="12" r="1.2" fill="#fff"/>',
  threads: '<rect width="34" height="34" rx="8" fill="#000"/><path d="M22.6 16.4c-.1 0-.2-.1-.3-.1-.2-3.1-1.9-4.9-4.7-4.9-1.7 0-3.1.7-4 2l1.6 1.1c.6-.9 1.5-1.1 2.4-1.1 1.5 0 2.6.9 2.8 2.6-.8-.2-1.6-.3-2.5-.2-2.6.1-4.2 1.6-4.1 3.6.1 1.9 1.8 3.2 3.9 3.1 2.4-.1 3.8-1.7 4-4 .8.5 1.3 1.2 1.5 2.1.3 1.5-.7 3.4-3.5 3.5-2.3.1-4-1.4-4.2-4.4v-1.4c.2-3 1.9-4.5 4.2-4.4.6 0 1.2.1 1.7.3l.7-1.9c-.7-.3-1.5-.4-2.4-.4-3.5 0-5.9 2.3-6.1 6.2v1.4c.2 3.9 2.6 6.2 6.1 6.2 3.8 0 5.7-2.6 5.3-5.2-.3-1.5-1.2-2.6-2.4-3.2z" fill="#fff"/>',
};

export function providerIcon(provider) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 34 34');
  svg.setAttribute('class', 'provider-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PROVIDER_SVG[provider] || ''; // trusted local constant only
  return svg;
}

export const PROVIDER_LABELS = Object.freeze({
  meta: 'Facebook Pages',
  instagram: 'Instagram Professional',
  threads: 'Threads',
});

export default { icon, providerIcon, PROVIDER_LABELS };
