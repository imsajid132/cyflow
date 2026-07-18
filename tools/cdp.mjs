/**
 * A tiny Chrome DevTools Protocol driver.
 *
 * Headless Chrome's `--screenshot` flag can only take a picture. The review
 * needs more than that: measure real layout, catch console errors, catch failed
 * requests, press keys, open drawers. Node 22+ ships a global WebSocket, and
 * CDP is a WebSocket + JSON, so this needs no dependency at all.
 *
 * A build/review tool. Nothing in src/ imports it.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function chromePath() {
  const { existsSync } = require('node:fs');
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error('Chrome not found');
}

/** Launch headless Chrome with a debugging port and connect to it. */
export async function launch({ width = 1440, height = 900, port = 9222 } = {}) {
  const { existsSync } = await import('node:fs');
  const exe = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (!exe) throw new Error('Chrome not found');

  const profile = mkdtempSync(join(tmpdir(), 'cyflow-cdp-'));
  const child = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  // Wait for the debugging endpoint.
  const deadline = Date.now() + 20000;
  let wsUrl = null;
  while (Date.now() < deadline && !wsUrl) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      wsUrl = info.webSocketDebuggerUrl;
    } catch {
      await new Promise((r) => { setTimeout(r, 250); });
    }
  }
  if (!wsUrl) throw new Error('Chrome debugging endpoint never came up');

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  // Attach to a page target.
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params = {}) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Network.enable');

  return {
    events,
    async setViewport(w, h) {
      await call('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: w < 700,
      });
    },
    /**
     * Send a REAL key event through the browser's input pipeline.
     *
     * A synthesised `new KeyboardEvent(...)` is untrusted: it will not move
     * focus on Tab, will not activate a button on Enter, and does not set the
     * keyboard modality that `:focus-visible` keys off. Auditing keyboard
     * behaviour with synthetic events measures the test, not the app.
     */
    async press(name, { shift = false } = {}) {
      const KEYS = {
        Tab: [9, 'Tab'], Enter: [13, 'Enter'], Escape: [27, 'Escape'], ' ': [32, 'Space'],
        ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'],
        ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
        Home: [36, 'Home'], End: [35, 'End'],
      };
      const [code, dom] = KEYS[name] || [0, name];
      const modifiers = shift ? 8 : 0;
      const base = {
        windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
        key: name === ' ' ? ' ' : name, code: dom, modifiers,
      };
      await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (name === ' ' || name === 'Enter') {
        await call('Input.dispatchKeyEvent', { type: 'char', ...base, text: name === ' ' ? ' ' : '\r' });
      }
      await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    /**
     * Emulate `prefers-reduced-motion: reduce` at the media-query level, which
     * is what the CSS actually keys off. Toggling a class would test our own
     * test hook rather than the rule a real user's setting triggers.
     */
    async emulateReducedMotion(on = true) {
      await call('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }],
      });
    },
    async goto(url, { waitMs = 2500 } = {}) {
      events.length = 0;
      await call('Page.navigate', { url });
      await new Promise((r) => { setTimeout(r, waitMs); });
    },
    async evaluate(expression) {
      const res = await call('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result.value;
    },
    async screenshot(path) {
      const { writeFileSync } = await import('node:fs');
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    /** Console errors + warnings, and any request that failed. */
    problems() {
      const out = { console: [], network: [] };
      for (const event of events) {
        if (event.method === 'Log.entryAdded') {
          const entry = event.params.entry;
          if (entry.level === 'error' || entry.level === 'warning') {
            out.console.push(`${entry.level}: ${entry.text}`);
          }
        }
        if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type)) {
          const text = (event.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          out.console.push(`${event.params.type}: ${text}`);
        }
        if (event.method === 'Network.loadingFailed') {
          out.network.push(`${event.params.errorText}: ${event.params.type}`);
        }
        if (event.method === 'Network.responseReceived' && event.params.response.status >= 400) {
          out.network.push(`HTTP ${event.params.response.status}: ${event.params.response.url}`);
        }
      }
      return out;
    },
    async close() {
      try { ws.close(); } catch { /* ignore */ }
      child.kill();
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

export default { launch };
