/**
 * Sidebar + accessible mobile drawer.
 *
 * Highlights the current route, closes on Escape / scrim click / link click,
 * and moves focus sensibly. Logout stays reachable but visually quiet.
 */

import { el } from './ui.js';
import { icon } from './icons.js';
import * as api from './api.js';
import { navigate, onRouteChange } from './router.js';

/**
 * Navigation, grouped by what the user is doing rather than one flat list.
 * Workspace is the daily work; Business is the setup that feeds it; Account is
 * everything you touch once a month.
 *
 * The groups are small on purpose. Three labels cost three rows, which still
 * fits a 13-inch laptop without the sidebar scrolling.
 */
const GROUPS = [
  {
    label: 'Workspace',
    items: [
      { path: '/dashboard', label: 'Dashboard', ico: 'dashboard' },
      // The planner is the primary workflow, so it sits above Create Post.
      { path: '/planner', label: 'Auto Planner', ico: 'planner' },
      { path: '/automations', label: 'Automations', ico: 'automations' },
      { path: '/create', label: 'Create Post', ico: 'create' },
      { path: '/calendar', label: 'Calendar', ico: 'calendar' },
      { path: '/queue', label: 'Queue', ico: 'queue' },
    ],
  },
  {
    label: 'Business',
    items: [
      { path: '/brand', label: 'Brand', ico: 'brand' },
      { path: '/media', label: 'Media', ico: 'media' },
      { path: '/connections', label: 'Connections', ico: 'connections' },
    ],
  },
  {
    label: 'Account',
    items: [
      { path: '/integrations', label: 'Integrations', ico: 'integrations' },
      { path: '/profile', label: 'Profile', ico: 'profile' },
      { path: '/settings', label: 'Settings', ico: 'settings' },
    ],
  },
];

let drawerOpen = false;

/** Everything inside the drawer a keyboard can land on, in order. */
function drawerFocusables(sidebar) {
  return [...sidebar.querySelectorAll('a[href], button:not([disabled])')]
    .filter((n) => n.offsetParent !== null || n === document.activeElement);
}

/**
 * Keep Tab inside the open drawer.
 *
 * Without this, tabbing past the last nav link walks into the page behind the
 * scrim: content the user cannot see, sitting under an overlay they cannot tell
 * they are behind. The drawer is modal, so its focus must be too.
 */
function trapDrawerFocus(event) {
  if (!drawerOpen || event.key !== 'Tab') return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const focusables = drawerFocusables(sidebar);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!sidebar.contains(document.activeElement)) {
    // Focus escaped some other way (a click on the scrim, say). Pull it back.
    event.preventDefault();
    first.focus();
  }
}

function setDrawer(open) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const toggle = document.getElementById('nav-toggle');
  drawerOpen = open;
  if (sidebar) sidebar.dataset.open = String(open);
  if (scrim) scrim.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  /*
   * The body must not scroll behind an open drawer: on a phone, scrolling the
   * page under the overlay moves content the user cannot see and loses their
   * place when the drawer closes.
   */
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) {
    const first = document.querySelector('#nav-list .nav-link');
    if (first) first.focus();
  } else if (toggle) {
    // Focus returns to the control that opened it, not to the top of the page.
    toggle.focus();
  }
}

/**
 * Mark the current nav item. A sub-route keeps its section highlighted, so
 * /planner/week still shows "Auto Planner" as current.
 */
function highlight(path) {
  document.querySelectorAll('#nav-list .nav-link').forEach((link) => {
    const href = link.getAttribute('href');
    const isCurrent = href === path || (href !== '/' && path.startsWith(`${href}/`));
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

export function initNav() {
  const list = document.getElementById('nav-list');
  if (!list) return;
  list.textContent = '';

  /*
   * Each group is its own <ul> under a heading, so assistive technology hears
   * "Workspace, list, 5 items" instead of one undifferentiated list of ten.
   * `aria-labelledby` ties the list to its heading; the heading itself is not a
   * link and is not focusable, because it does not do anything.
   */
  GROUPS.forEach((group, index) => {
    const id = `nav-group-${index}`;
    const heading = el('li', {
      className: 'nav-group-label',
      attrs: { id, role: 'presentation' },
      text: group.label,
    });
    list.appendChild(heading);

    const sub = el('ul', { className: 'nav-sublist', attrs: { 'aria-labelledby': id } });
    for (const item of group.items) {
      const link = el('a', {
        className: 'nav-link',
        attrs: { href: item.path, 'data-link': '' },
        on: { click: () => setDrawer(false) },
      }, [icon(item.ico), el('span', { text: item.label })]);
      sub.appendChild(el('li', {}, [link]));
    }
    list.appendChild(el('li', { attrs: { role: 'presentation' } }, [sub]));
  });

  document.getElementById('nav-toggle')?.addEventListener('click', () => setDrawer(!drawerOpen));
  document.getElementById('nav-close')?.addEventListener('click', () => setDrawer(false));
  document.getElementById('scrim')?.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) setDrawer(false);
    trapDrawerFocus(e);
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await api.apiRequest('/api/auth/logout', { method: 'POST', body: {} });
    api.clearCachedCsrfToken();
    navigate('/login', { replace: true });
  });

  onRouteChange((path, user) => {
    highlight(path);
    setDrawer(false);
    const box = document.getElementById('nav-user');
    const name = document.getElementById('nav-user-name');
    if (box && name) {
      box.hidden = !user;
      name.textContent = user ? user.name : '';
    }
  });
}

export default { initNav };
