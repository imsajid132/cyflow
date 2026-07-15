/**
 * URL / SSRF safety guards for the website analyzer.
 *
 * The analyzer fetches URLs that originate from user input, so every hop is
 * validated: scheme, hostname shape, DNS resolution, and the resolved IPs
 * (IPv4 + IPv6) against loopback / private / link-local / metadata ranges.
 * Redirect targets are re-validated with the same rules.
 *
 * Policy (chosen deliberately): HTTPS is REQUIRED in production; plain HTTP is
 * permitted only outside production and is reported as a warning.
 *
 * NOTE on DNS rebinding: we resolve and validate every address for a host
 * before connecting. A hostile authoritative DNS server could still flip the
 * record between our check and the socket connect (a TOCTOU window). Closing it
 * entirely requires pinning the connection to the validated IP via a custom
 * agent; that is documented as a known limitation rather than silently implied.
 */

import dns from 'node:dns/promises';
import net from 'node:net';

import { ValidationError } from './errors.js';

/** Paths we never crawl (state-changing / private areas). */
const DISALLOWED_PATH_RE =
  /(^|\/)(logout|signout|sign-out|login|signin|sign-in|admin|wp-admin|account|accounts|checkout|cart|basket|register|password|reset|billing|invoice|order|dashboard|profile|settings|api)(\/|$)/i;

/** Hostnames that must never be fetched. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** Internal-looking TLDs/suffixes. */
const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localdomain', '.home.arpa', '.lan'];

/** True for an IPv4 string inside a private/reserved range. */
export function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + AWS/GCP metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24, 192.0.2/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** True for an IPv6 string inside a private/reserved range. */
export function isPrivateIPv6(ip) {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone index
  if (addr === '::' || addr === '::1') return true; // unspecified / loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — validate the embedded v4.
  const mapped = /^::(ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (mapped) return isPrivateIPv4(mapped[2]);
  if (addr.startsWith('fe80') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (/^f[cd]/.test(addr)) return true; // unique local fc00::/7
  if (addr.startsWith('ff')) return true; // multicast
  if (addr.startsWith('2001:db8')) return true; // documentation
  if (addr.startsWith('64:ff9b')) return true; // NAT64
  return false;
}

/** True if the literal IP (v4 or v6) is private/reserved. */
export function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not an IP → treat as unsafe
}

/** True when the hostname itself is obviously internal. */
export function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (!host.includes('.') && !net.isIP(host)) return true; // bare internal name
  return false;
}

/**
 * Normalize user-supplied website input into a safe absolute URL.
 * Adds https:// when no scheme is given; strips credentials, hash, and query.
 * @param {string} input
 * @param {{ isProd?: boolean }} [opts]
 * @returns {{ url: URL, warnings: string[] }}
 */
export function normalizeWebsiteUrl(input, { isProd = false } = {}) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw || raw.length > 2000) {
    throw new ValidationError('A valid website URL is required');
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new ValidationError('A valid website URL is required');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('Only http and https website addresses are supported');
  }
  // Embedded credentials are never accepted.
  if (url.username || url.password) {
    throw new ValidationError('The website URL must not contain credentials');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new ValidationError('That website address cannot be analyzed');
  }

  const warnings = [];
  if (url.protocol === 'http:') {
    if (isProd) {
      throw new ValidationError('Only secure (https) website addresses can be analyzed');
    }
    warnings.push('insecure_http');
  }

  // Strip query + hash (we never need them and they may carry tokens).
  url.search = '';
  url.hash = '';
  return { url, warnings };
}

/** True when a path looks like a private/state-changing area we must skip. */
export function isDisallowedPath(pathname) {
  return DISALLOWED_PATH_RE.test(String(pathname || ''));
}

/**
 * The registrable-ish domain used to keep crawling on the same site.
 * Uses the last two labels (adequate for our same-site restriction; we do not
 * ship a public-suffix list, so multi-part TLDs fall back to the last three).
 */
export function registrableDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const twoPartTlds = ['co.uk', 'com.au', 'co.nz', 'com.br', 'co.za', 'com.pk', 'co.in', 'com.mx'];
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.includes(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

/** True when `candidate` is on the same registrable domain as `base`. */
export function isSameSite(candidateHost, baseHost) {
  return registrableDomain(candidateHost) === registrableDomain(baseHost);
}

/**
 * Resolve a hostname and assert EVERY resolved address is public.
 * @param {string} hostname
 * @param {{ lookup?: Function }} [deps] injectable resolver for tests
 * @returns {Promise<string[]>} the validated addresses
 */
export async function assertPublicHost(hostname, { lookup } = {}) {
  if (isBlockedHostname(hostname)) {
    throw new ValidationError('That website address cannot be analyzed');
  }
  // A literal IP needs no DNS but must still be public.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new ValidationError('That website address cannot be analyzed');
    }
    return [hostname];
  }

  const resolver = lookup || ((h) => dns.lookup(h, { all: true, verbatim: true }));
  let records;
  try {
    records = await resolver(hostname);
  } catch {
    // Never surface the raw DNS error.
    throw new ValidationError('That website could not be reached');
  }
  const addresses = (Array.isArray(records) ? records : [records])
    .map((r) => (typeof r === 'string' ? r : r?.address))
    .filter(Boolean);

  if (addresses.length === 0) {
    throw new ValidationError('That website could not be reached');
  }
  // ALL addresses must be public — a single private answer rejects the host.
  for (const address of addresses) {
    if (isPrivateIp(address)) {
      throw new ValidationError('That website address cannot be analyzed');
    }
  }
  return addresses;
}

export default {
  normalizeWebsiteUrl,
  assertPublicHost,
  isPrivateIp,
  isPrivateIPv4,
  isPrivateIPv6,
  isBlockedHostname,
  isDisallowedPath,
  registrableDomain,
  isSameSite,
};
