/**
 * Application bootstrap: prime the in-memory CSRF token, build navigation,
 * then start the router.
 */

import { getCsrfToken } from './api.js';
import { initNav } from './nav.js';
import { startRouter } from './router.js';

initNav();
getCsrfToken();
startRouter();
