/**
 * Staging health — ask a deployed environment whether it can actually work.
 *
 * "The HTTP process answered" is not health. A live web process with a dead
 * worker means posts silently stop going out and nothing looks wrong, so this
 * reports liveness and readiness separately.
 *
 * Read-only. It sends one GET and prints a verdict per component. It never
 * sends credentials, never prints a response body, and never echoes a URL that
 * might carry a token in its query string.
 *
 * Usage:
 *   node tools/staging-health.mjs https://staging.example  [--timeout 10000]
 *   STAGING_BASE_URL=https://staging.example node tools/staging-health.mjs
 *
 * Exit: 0 = pass, 1 = blocked, 2 = could not reach the target.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASS = 'PASS';
export const WARN = 'WARNING';
export const BLOCK = 'BLOCKED';

/** Age beyond which a worker heartbeat means "nothing is processing jobs". */
const HEARTBEAT_STALE_SECONDS = 120;

/**
 * Turn a /health payload into component verdicts.
 * Pure, so tests can drive it with fixtures instead of a live server.
 */
export function evaluate(payload, { nowMs = 0 } = {}) {
  const out = [];
  const add = (component, status, detail) => out.push({ component, status, detail });
  const body = payload && typeof payload === 'object' ? payload : {};
  const data = body.data && typeof body.data === 'object' ? body.data : body;

  add('http', PASS, 'the web process answered');

  const db = data.database ?? data.db;
  if (db === undefined) add('database', WARN, 'not reported by this endpoint');
  else add('database', db === true || db === 'ok' || db?.ok === true ? PASS : BLOCK,
    db === true || db === 'ok' || db?.ok === true ? 'reachable' : 'not reachable');

  /*
   * A worker that has not checked in recently is, for practical purposes, down.
   *
   * Presence is tested explicitly rather than with `??`, because `null` is a
   * MEANINGFUL value here: it says "no worker has ever checked in". Coalescing
   * it away reported a worker that had never started as merely "not reported",
   * which is the difference between a warning and an outage.
   */
  const hasHb = (data.worker && 'lastHeartbeatAt' in data.worker) || 'workerHeartbeatAt' in data;
  const hb = hasHb
    ? (data.worker && 'lastHeartbeatAt' in data.worker ? data.worker.lastHeartbeatAt : data.workerHeartbeatAt)
    : undefined;
  if (!hasHb) {
    add('worker', WARN, 'no heartbeat reported by this endpoint');
  } else if (!hb) {
    add('worker', BLOCK, 'no worker has ever checked in');
  } else {
    const ageSec = Math.max(0, Math.round((nowMs - Date.parse(hb)) / 1000));
    add('worker', ageSec > HEARTBEAT_STALE_SECONDS ? BLOCK : PASS,
      `last heartbeat ${ageSec}s ago`);
  }

  const sched = data.scheduler?.lastRunAt ?? data.schedulerLastRunAt;
  if (sched === undefined) add('scheduler', WARN, 'no last-run reported by this endpoint');
  else if (!sched) add('scheduler', WARN, 'scheduler has not run yet');
  else add('scheduler', PASS, 'has run');

  const live = data.publishing?.liveEnabled ?? data.livePublishing;
  if (live === undefined) add('live publishing', WARN, 'flag not reported');
  else add('live publishing', live ? WARN : PASS,
    live ? 'ENABLED — provider calls will be made' : 'disabled (no provider calls)');

  const jobs = data.jobs || {};
  if (jobs.failed !== undefined) {
    add('failed jobs', Number(jobs.failed) > 0 ? WARN : PASS, `${jobs.failed} failed`);
  }
  if (jobs.stale !== undefined) {
    add('stale jobs', Number(jobs.stale) > 0 ? WARN : PASS, `${jobs.stale} stale`);
  }

  return out;
}

/** Fetch and evaluate. Never logs the body; only derived verdicts escape. */
export async function checkHealth(baseUrl, { timeoutMs = 10000, fetchImpl = fetch, nowMs } = {}) {
  let url;
  try {
    url = new URL('/health', baseUrl);
  } catch {
    return { reachable: false, error: 'the base URL is not a valid URL', results: [] };
  }
  if (url.protocol !== 'https:' && !/^(localhost|127\.)/.test(url.hostname)) {
    return { reachable: false, error: 'refusing to probe a non-https remote origin', results: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      // Deliberately does not print the body: an error page can contain a stack
      // trace, a path, or a token echoed back from a query string.
      return { reachable: true, error: `health did not return JSON (HTTP ${res.status})`, results: [] };
    }
    if (!res.ok) {
      return { reachable: true, error: `health returned HTTP ${res.status}`, results: evaluate(payload, { nowMs: nowMs ?? Date.now() }) };
    }
    return { reachable: true, error: null, results: evaluate(payload, { nowMs: nowMs ?? Date.now() }) };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `no response within ${timeoutMs}ms` : (err?.code || 'connection failed');
    return { reachable: false, error: reason, results: [] };
  } finally {
    clearTimeout(timer);
  }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const base = process.argv.find((a) => /^https?:\/\//.test(a)) || process.env.STAGING_BASE_URL;
  if (!base) {
    console.error('usage: node tools/staging-health.mjs <https-base-url>  (or set STAGING_BASE_URL)');
    process.exit(2);
  }
  const tIdx = process.argv.indexOf('--timeout');
  const timeoutMs = tIdx > -1 ? Number(process.argv[tIdx + 1]) || 10000 : 10000;

  const { reachable, error, results } = await checkHealth(base, { timeoutMs });
  if (!reachable) {
    console.error(`BLOCKED — could not reach the target: ${error}`);
    process.exit(2);
  }
  for (const r of results) {
    console.log(`  ${r.status.padEnd(8)} ${r.component.padEnd(18)} ${r.detail}`);
  }
  if (error) console.log(`\n  note: ${error}`);
  const blocked = results.filter((r) => r.status === BLOCK).length;
  const warned = results.filter((r) => r.status === WARN).length;
  console.log(`\n${results.length} components, ${blocked} blocked, ${warned} warnings`);
  console.log(blocked ? 'RESULT: BLOCKED' : 'RESULT: PASS');
  process.exit(blocked || error ? 1 : 0);
}
