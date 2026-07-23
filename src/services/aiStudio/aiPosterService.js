/**
 * src/services/aiStudio/aiPosterService.js
 *
 * Orchestrates the poster generation: for a business's brand + copy, ask Claude to
 * DESIGN each of the three styles as HTML, then render each to a 1080x1080 PNG.
 * Same three styles as the reference app, driven by the business's own brand.
 */
import { askClaude, extractHtml } from './claudeClient.js';
import { DESIGN_STYLES, DESIGN_SYSTEM_PROMPT, buildDesignUserPrompt } from './designPrompts.js';
import { renderHtmlToPng } from './posterRenderer.js';

/** Ask Claude for one style's HTML. Returns null if it didn't produce valid HTML. */
async function designOne(input, style) {
  try {
    const raw = await askClaude({
      system: DESIGN_SYSTEM_PROMPT,
      userText: buildDesignUserPrompt(input, style.direction),
      maxTokens: 4000,
    });
    const html = extractHtml(raw);
    if (!html || !/<html|<!doctype/i.test(html)) return null;
    return { style, html };
  } catch {
    return null;
  }
}

/**
 * Generate the poster set for one post.
 * @param {{ brand:{businessName:string,industry?:string,tone?:string}, colors:{primary:string,secondary:string,accent:string}, font?:string, content:{headline:string,subtext?:string,cta?:string}, images?:object[], styleIds?:string[] }} input
 * @returns {Promise<{ id:string, label:string, html:string, png:Buffer }[]>}
 */
export async function generatePosters(input) {
  const styles = Array.isArray(input.styleIds) && input.styleIds.length
    ? DESIGN_STYLES.filter((s) => input.styleIds.includes(s.id))
    : DESIGN_STYLES;

  // 1) Design all styles in parallel (independent Claude calls).
  const designed = (await Promise.all(styles.map((s) => designOne(input, s)))).filter(Boolean);

  // 2) Render each to a PNG. Sequential + a distinct CDP port per render, so a
  //    single-process host stays calm and local Chrome instances never clash.
  const out = [];
  let port = 9700;
  for (const d of designed) {
    port += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const png = await renderHtmlToPng(d.html, { port });
      out.push({ id: d.style.id, label: d.style.label, html: d.html, png });
    } catch {
      /* skip a style that failed to render; the others still return */
    }
  }
  return out;
}
