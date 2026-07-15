/**
 * Connections page — all OAuth account management lives here.
 * HCTI credentials are NOT shown on this page (see /integrations).
 */

import { el, pageHead, notice } from '../ui.js';
import { renderProviderCards, consumeOAuthResult } from '../components/providerCards.js';

export async function render(root) {
  consumeOAuthResult(); // safe success/error notice, then strips the query
  const host = el('div', {});

  root.appendChild(el('div', { className: 'page' }, [
    pageHead('Connections', 'Connect the Facebook Pages, Instagram Professional accounts, and Threads profiles you post to.'),
    host,
    notice('Cyflow stores an encrypted access token per account. Disconnecting removes it locally and never affects your other accounts.', 'info'),
  ]));

  await renderProviderCards(host);
}
