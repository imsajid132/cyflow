/**
 * Public marketing chrome — the header + footer shared by every public page.
 *
 * Distinct from the authenticated app shell (sidebar/topbar): the public site has
 * its own navigation and never assumes a signed-in user. Links use data-link so
 * the SPA router handles them; the only "external" affordances are the same-origin
 * app entry points (Log in / Get started). No third-party assets are loaded.
 */

import { el } from '../ui.js';

const NAV = [
  ['/features', 'Features'],
  ['/how-it-works', 'How it works'],
  ['/security', 'Security'],
  ['/about', 'About'],
  ['/contact', 'Contact'],
];

/** The public top navigation. `active` highlights the current path. `user` (if
 * signed in) swaps "Log in / Get started" for a single "Open dashboard". */
export function publicHeader(active, user) {
  const links = NAV.map(([href, label]) => el('a', {
    className: `pub-nav-link${active === href ? ' is-active' : ''}`,
    text: label,
    attrs: { href, 'data-link': '', ...(active === href ? { 'aria-current': 'page' } : {}) },
  }));

  const cta = user
    ? [el('a', { className: 'btn btn-primary btn-sm', text: 'Open dashboard', attrs: { href: '/dashboard', 'data-link': '' } })]
    : [
      el('a', { className: 'btn btn-ghost btn-sm', text: 'Log in', attrs: { href: '/login', 'data-link': '' } }),
      el('a', { className: 'btn btn-primary btn-sm', text: 'Get started', attrs: { href: '/register', 'data-link': '' } }),
    ];

  // A native <details> makes the mobile menu keyboard-accessible with no JS.
  const mobile = el('details', { className: 'pub-nav-mobile' }, [
    el('summary', { className: 'pub-nav-toggle', attrs: { 'aria-label': 'Menu' } }, [el('span', { className: 'hamburger', attrs: { 'aria-hidden': 'true' } })]),
    el('div', { className: 'pub-nav-drawer' }, [...NAV.map(([href, label]) => el('a', { className: 'pub-nav-link', text: label, attrs: { href, 'data-link': '' } })), ...cta]),
  ]);

  return el('header', { className: 'pub-header' }, [
    el('div', { className: 'pub-header-inner' }, [
      el('a', { className: 'pub-brand', attrs: { href: '/', 'data-link': '', 'aria-label': 'Cyflow Social home' } }, [
        el('img', { attrs: { src: '/assets/brand/cyflow-mark-64.png', alt: '', width: '28', height: '28' } }),
        el('span', { text: 'Cyflow Social' }),
      ]),
      el('nav', { className: 'pub-nav', attrs: { 'aria-label': 'Primary' } }, links),
      el('div', { className: 'pub-header-cta' }, cta),
      mobile,
    ]),
  ]);
}

/** The public footer — honest product/company/legal links + the year. */
export function publicFooter() {
  const col = (title, items) => el('div', { className: 'pub-foot-col' }, [
    el('h3', { className: 'pub-foot-title', text: title }),
    ...items.map(([href, label]) => el('a', { className: 'pub-foot-link', text: label, attrs: { href, 'data-link': '' } })),
  ]);
  // A fixed marketing year avoids a runtime clock; update at release time.
  const year = 2026;
  return el('footer', { className: 'pub-footer' }, [
    el('div', { className: 'pub-footer-inner' }, [
      el('div', { className: 'pub-foot-brand' }, [
        el('a', { className: 'pub-brand', attrs: { href: '/', 'data-link': '' } }, [
          el('img', { attrs: { src: '/assets/brand/cyflow-mark-64.png', alt: '', width: '26', height: '26' } }),
          el('span', { text: 'Cyflow Social' }),
        ]),
        el('p', { className: 'pub-foot-sub', text: 'Plan, write and publish social content for Facebook Pages, Instagram Professional and Threads.' }),
      ]),
      col('Product', [['/features', 'Features'], ['/how-it-works', 'How it works'], ['/security', 'Security']]),
      col('Company', [['/about', 'About'], ['/contact', 'Contact']]),
      col('Legal', [['/privacy', 'Privacy'], ['/terms', 'Terms']]),
      col('Get started', [['/login', 'Log in'], ['/register', 'Create account']]),
    ]),
    el('div', { className: 'pub-footer-base' }, [
      el('span', { text: `© ${year} Cyflow Social` }),
      el('span', { className: 'pub-foot-note', text: 'Supported platforms: Facebook Pages, Instagram Professional, Threads.' }),
    ]),
  ]);
}

export default { publicHeader, publicFooter };
