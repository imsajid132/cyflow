/**
 * Lightweight same-origin router.
 *
 * Every route is direct-loadable: Express serves the shell for each path, and
 * this router renders the matching page module (dynamically imported, so page
 * logic is not downloaded for routes you never visit). Navigation is restricted
 * to same-origin paths — external URLs are never opened by the router.
 */

import * as api from './api.js';
import { clear, skeleton, toast } from './ui.js';

const ROUTES = {
  '/': { redirect: true },
  '/login': { layout: 'auth', view: 'login', load: () => import('./pages/auth.js') },
  '/register': { layout: 'auth', view: 'register', load: () => import('./pages/auth.js') },
  '/onboarding': { redirectTo: '/onboarding/business' },
  '/onboarding/business': { layout: 'wizard', view: 'business', auth: true, load: () => import('./pages/onboarding.js') },
  '/onboarding/brand': { layout: 'wizard', view: 'brand', auth: true, load: () => import('./pages/onboarding.js') },
  '/onboarding/connections': { layout: 'wizard', view: 'connections', auth: true, load: () => import('./pages/onboarding.js') },
  '/dashboard': { layout: 'app', auth: true, load: () => import('./pages/dashboard.js') },
  '/brand': { layout: 'app', auth: true, load: () => import('./pages/brand.js') },
  '/connections': { layout: 'app', auth: true, load: () => import('./pages/connections.js') },
  '/create': { layout: 'app', auth: true, load: () => import('./pages/create.js') },
  '/queue': { layout: 'app', auth: true, load: () => import('./pages/queue.js') },
  '/calendar': { layout: 'app', auth: true, load: () => import('./pages/calendar.js') },
  '/integrations': { layout: 'app', auth: true, load: () => import('./pages/integrations.js') },
  '/profile': { layout: 'app', auth: true, load: () => import('./pages/profile.js') },
  '/settings': { layout: 'app', auth: true, load: () => import('./pages/settings.js') },
};

const TITLES = {
  '/login': 'Sign in', '/register': 'Create account', '/dashboard': 'Dashboard',
  '/brand': 'Brand', '/connections': 'Connections', '/create': 'Create Post',
  '/queue': 'Queue', '/calendar': 'Calendar', '/integrations': 'Integrations',
  '/profile': 'Profile', '/settings': 'Settings',
  '/onboarding/business': 'Business setup', '/onboarding/brand': 'Brand review',
  '/onboarding/connections': 'Connect accounts',
};

let currentUser = null;
const listeners = new Set();

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Only same-origin absolute paths are navigable. */
export function isSafePath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

export function navigate(path, { replace = false } = {}) {
  if (!isSafePath(path)) return;
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  render();
}

function setLayout(layout) {
  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  const shell = document.getElementById('shell');
  const isApp = layout === 'app';
  if (sidebar) sidebar.hidden = !isApp;
  if (topbar) topbar.style.display = isApp ? '' : 'none';
  if (shell) shell.dataset.layout = layout;
  const main = document.getElementById('main');
  if (main) main.classList.toggle('centered', layout !== 'app');
}

export function getUser() {
  return currentUser;
}

/** Decide where a freshly authenticated user should land. */
export async function postAuthRedirect() {
  const state = await api.onboardingState();
  if (state && state.needsOnboarding) navigate('/onboarding/business', { replace: true });
  else navigate('/dashboard', { replace: true });
}

export async function render() {
  const path = window.location.pathname;
  const root = document.getElementById('route-root');
  if (!root) return;

  let route = ROUTES[path];
  if (!route) {
    // Unknown in-app path → dashboard (Express serves the 404 page otherwise).
    navigate('/dashboard', { replace: true });
    return;
  }
  if (route.redirectTo) {
    navigate(route.redirectTo, { replace: true });
    return;
  }

  // Auth check (single source of truth: the server session).
  currentUser = await api.me();

  if (route.redirect) {
    navigate(currentUser ? '/dashboard' : '/login', { replace: true });
    return;
  }
  if (route.auth && !currentUser) {
    navigate('/login', { replace: true });
    return;
  }
  if (!route.auth && currentUser && (path === '/login' || path === '/register')) {
    await postAuthRedirect();
    return;
  }

  setLayout(route.layout);
  document.title = TITLES[path] ? `${TITLES[path]} · Cyflow Social` : 'Cyflow Social';
  listeners.forEach((fn) => fn(path, currentUser));

  clear(root);
  root.appendChild(skeleton({ lines: 3 }));

  try {
    const mod = await route.load();
    clear(root);
    await mod.render(root, { user: currentUser, navigate, view: route.view, path });
  } catch (err) {
    clear(root);
    toast('This page could not be loaded. Please try again.', 'err');
  }
  const main = document.getElementById('main');
  if (main) main.focus({ preventScroll: true });
}

export function startRouter() {
  // Intercept same-origin links marked with data-link.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!isSafePath(href)) return; // never intercept external links
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => render());
  render();
}

export default { startRouter, navigate, render, onRouteChange, getUser, isSafePath, postAuthRedirect };
