/**
 * src/services/aiStudio/posterRenderer.js
 *
 * Turn Claude's 1080x1080 HTML poster into a PNG buffer. FREE — no paid service.
 * Two modes, chosen by env so the same code runs on a VPS or on shared hosting:
 *
 *   POSTER_RENDER_MODE = "local"   (default)  free headless Chrome on this host
 *   POSTER_RENDER_MODE = "remote"             POST the HTML to a free companion
 *                                             render service (POSTER_RENDER_URL)
 *
 * Local mode reuses the repo's dependency-free CDP driver (tools/cdp.mjs) which
 * launches the system Chrome — no npm dependency, no cost.
 */
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = 1080;

async function renderLocal(html, port) {
  const { launch } = await import('../../../tools/cdp.mjs');
  const base = join(tmpdir(), `cyflow-poster-${port}-${process.pid}`);
  const htmlPath = `${base}.html`;
  const pngPath = `${base}.png`;
  writeFileSync(htmlPath, html);
  const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
  const b = await launch({ width: SIZE, height: SIZE, port });
  try {
    await b.goto(fileUrl, { waitMs: 2500 });
    await b.screenshot(pngPath);
    return readFileSync(pngPath);
  } finally {
    await b.close().catch(() => {});
    try { rmSync(htmlPath); } catch { /* ignore */ }
    try { rmSync(pngPath); } catch { /* ignore */ }
  }
}

async function renderRemote(html) {
  const url = process.env.POSTER_RENDER_URL;
  if (!url) throw new Error('POSTER_RENDER_URL is not set for remote render mode.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html, width: SIZE, height: SIZE }),
  });
  if (!res.ok) throw new Error(`Render service failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * @param {string} html  a complete self-contained 1080x1080 HTML document
 * @param {{ port?:number }} [opts]  local mode needs a unique CDP port per concurrent render
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderHtmlToPng(html, { port = 9700 } = {}) {
  const mode = (process.env.POSTER_RENDER_MODE || 'local').toLowerCase();
  if (mode === 'remote') return renderRemote(html);
  return renderLocal(html, port);
}
