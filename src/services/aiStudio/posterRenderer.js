/**
 * src/services/aiStudio/posterRenderer.js
 *
 * Turn Claude's 1080x1080 poster into a PNG buffer. FREE — no paid service.
 *
 * TWO INPUT SHAPES, both free:
 *
 *  1. renderSvgToPng(svg)   — a self-contained <svg> poster, rasterized with
 *     @resvg/resvg-js. NO browser, so it runs on ANY host including Hostinger
 *     managed Node (shared hosting). This is the free-forever, Hostinger-safe
 *     path and the one the automation uses.
 *
 *  2. renderHtmlToPng(html)  — a full HTML/CSS poster, rasterized with headless
 *     Chrome (local) or a free companion service (remote). Higher fidelity, but
 *     needs a browser somewhere, so it is for a VPS / local dev, not shared
 *     hosting. Chosen by env:
 *       POSTER_RENDER_MODE = "local"  (default)  free headless Chrome here
 *       POSTER_RENDER_MODE = "remote"            POST HTML to POSTER_RENDER_URL
 *
 * Local mode reuses the repo's dependency-free CDP driver (tools/cdp.mjs) which
 * launches the system Chrome — no npm dependency, no cost.
 */
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = 1080;

/**
 * Rasterize a self-contained SVG poster to a 1080x1080 PNG with @resvg/resvg-js.
 * Browserless and free — the Hostinger-safe render path.
 *
 * Fonts: system fonts are loaded, plus any TTF/OTF in POSTER_FONT_DIR (bundle a
 * couple of premium open-source fonts there for a look that is identical on
 * every host). `defaultFontFamily` (POSTER_DEFAULT_FONT) is the fallback so text
 * never silently vanishes when a requested family is absent.
 *
 * @param {string} svg  a complete <svg ...>...</svg> document, 1080x1080
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderSvgToPng(svg) {
  if (!svg || !/<svg[\s>]/i.test(svg)) throw new Error('renderSvgToPng needs an <svg> document.');
  // Imported lazily so a host that only ever renders HTML pays nothing for it.
  const { Resvg } = await import('@resvg/resvg-js');
  const fontDir = process.env.POSTER_FONT_DIR || null;
  const font = {
    loadSystemFonts: true,
    defaultFontFamily: process.env.POSTER_DEFAULT_FONT || 'DejaVu Sans',
  };
  if (fontDir && existsSync(fontDir)) font.fontDirs = [fontDir];
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE }, font });
  return Buffer.from(resvg.render().asPng());
}

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
