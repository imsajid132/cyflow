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
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1080;

/** The faces shipped with the app — see the note in renderSvgToPng. */
const BUNDLED_FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'fonts');

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

  /*
   * FONTS ARE SHIPPED, NOT ASSUMED.
   *
   * A production render came back with every glyph as a missing-character box:
   * the host has no system fonts at all, so nothing matched and resvg drew tofu.
   * The poster was unreadable while the copy beside it was perfect — a failure
   * that looks like a design bug and is really a missing dependency.
   *
   * The app therefore carries its own faces (assets/fonts, OFL-licensed) and
   * points the renderer at them. `loadSystemFonts` stays on so a machine WITH
   * fonts can still satisfy a family the design asks for, but nothing depends on
   * that being true. POSTER_FONT_DIR can add more faces for a host that wants a
   * different look.
   */
  const dirs = [BUNDLED_FONT_DIR, process.env.POSTER_FONT_DIR].filter((d) => d && existsSync(d));
  const font = {
    loadSystemFonts: true,
    fontDirs: dirs,
    // The bundled sans, so text renders even when the requested family is absent.
    defaultFontFamily: process.env.POSTER_DEFAULT_FONT || 'Inter',
  };
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
