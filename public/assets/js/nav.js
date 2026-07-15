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

const ITEMS = [
  { path: '/dashboard', label: 'Dashboard', ico: 'dashboard' },
  { path: '/brand', label: 'Brand', ico: 'brand' },
  { path: '/connections', label: 'Connections', ico: 'connections' },
  { path: '/create', label: 'Create Post', ico: 'create' },
  { path: '/calendar', label: 'Calendar', ico: 'calendar' },
  { path: '/queue', label: 'Queue', ico: 'queue' },
  { path: '/integrations', label: 'Integrations', ico: 'integrations' },
  { path: '/profile', label: 'Profile', ico: 'profile' },
  { path: '/settings', label: 'Settings', ico: 'settings' },
];

let drawerOpen = false;

function setDrawer(open) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const toggle = document.getElementById('nav-toggle');
  drawerOpen = open;
  if (sidebar) sidebar.dataset.open = String(open);
  if (scrim) scrim.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  if (open) {
    const first = document.querySelector('#nav-list .nav-link');
    if (first) first.focus();
  } else if (toggle) {
    toggle.focus();
  }
}

function highlight(path) {
  document.querySelectorAll('#nav-list .nav-link').forEach((link) => {
    if (link.getAttribute('href') === path) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

export function initNav() {
  const list = document.getElementById('nav-list');
  if (!list) return;
  list.textContent = '';

  for (const item of ITEMS) {
    const link = el('a', {
      className: 'nav-link',
      attrs: { href: item.path, 'data-link': '' },
      on: { click: () => setDrawer(false) },
    }, [icon(item.ico), el('span', { text: item.label })]);
    list.appendChild(el('li', {}, [link]));
  }

  document.getElementById('nav-toggle')?.addEventListener('click', () => setDrawer(!drawerOpen));
  document.getElementById('nav-close')?.addEventListener('click', () => setDrawer(false));
  document.getElementById('scrim')?.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) setDrawer(false);
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
