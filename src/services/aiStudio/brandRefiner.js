/**
 * src/services/aiStudio/brandRefiner.js
 *
 * What the page MEANS, decided by Claude, after the parser has said what the
 * page CONTAINS.
 *
 * WHY. Pattern-matching a modern marketing site produces confident nonsense. A
 * real SEO company came back with its industry as "Professional service" (the
 * generic schema container it happened to declare) and its services as
 * "Six services. One unified playbook.", "The same fundamentals, a different
 * finish line." and "Foundations" — section headings and taglines, sitting in
 * the list a designer would use to decide what the business does. The real
 * services were in that same list, mixed in and indistinguishable by rule.
 *
 * Selecting the real ones is a judgement, not a pattern, and the product already
 * says Claude makes the judgements. So the parser keeps doing what it is good at
 * — colours, logo, fonts, phone, address, the raw candidates — and Claude is
 * handed those candidates and asked which are true.
 *
 * It only ever REPLACES four editorial fields. Facts the model cannot see from
 * text (colours, logo, fonts, contact details) are never touched by it, and a
 * failure leaves the mechanical read exactly as it was: a slower answer is worth
 * having, a lost one is not.
 */

import { askClaude, parseJsonFromModel, isClaudeConfigured } from './claudeClient.js';

const SYSTEM = `You are given what an automated reader scraped from a company's website. The reader cannot tell a service from a section heading, so its lists contain both.

Return the truth about this business as a single JSON object, no markdown and no commentary:

{
  "industry": "...",
  "description": "...",
  "services": ["...", "..."],
  "tone": "..."
}

Rules:
- "industry": what this business IS, as specifically as the page supports — "SEO agency", "Waterproofing contractor", "Specialty coffee roaster". Never a schema.org container like "Professional service", "Organization" or "Local business": those are categories of category, and they describe nothing.
- "services": ONLY the things a customer can actually buy or book. Drop taglines, section headings, benefits, promises, navigation labels and anything that is a sentence. If a candidate is a real service, keep its own wording. Return at most 10, most important first. Return an empty list rather than inventing one.
- "description": one or two plain sentences about what the business does and who for. Use only what the page says. No marketing adjectives that are not on the page.
- "tone": three or four words describing how this brand sounds, e.g. "direct, technical, confident".
- Never invent a fact, a statistic, a price or a guarantee. If the page does not support it, leave it out.`;

/** A compact, safe view of the scrape for the prompt. */
function buildPrompt(read) {
  const lines = [
    `WEBSITE: ${read.websiteUrl || '(unknown)'}`,
    `NAME THE READER FOUND: ${read.businessName || '(none)'}`,
    `CATEGORY THE READER GUESSED: ${read.industry || '(none)'}`,
    '',
    'PAGE DESCRIPTION:',
    read.description || '(none)',
  ];
  if (read.services?.length) {
    lines.push('', 'CANDIDATE SERVICES (a mix of real services and headings/taglines):');
    for (const s of read.services) lines.push(`- ${s}`);
  }
  if (read.headings?.length) {
    lines.push('', 'OTHER HEADINGS ON THE PAGE:');
    for (const h of read.headings) lines.push(`- ${h}`);
  }
  lines.push('', 'Return the JSON object now.');
  return lines.join('\n');
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * @param {{ websiteUrl?:string, businessName?:string, industry?:string, description?:string,
 *           services?:string[], headings?:string[] }} read the mechanical scrape
 * @returns {Promise<null|{industry:string, description:string, services:string[], tone:string}>}
 *          null when the AI is unavailable or unusable — the caller keeps the scrape.
 */
export async function refineBrand(read) {
  if (!isClaudeConfigured()) return null;
  try {
    const raw = await askClaude({ system: SYSTEM, userText: buildPrompt(read), maxTokens: 900 });
    const out = parseJsonFromModel(raw) || {};
    const services = Array.isArray(out.services)
      ? out.services.map((s) => str(s, 80)).filter(Boolean).slice(0, 10)
      : [];
    const industry = str(out.industry, 80);
    /*
     * A model that hands back the same generic container the reader guessed has
     * added nothing, so it is refused rather than shown as an improvement.
     */
    const generic = /^(professional service|organization|local business|business|company|service|corporation|thing)$/i;
    return {
      industry: generic.test(industry) ? '' : industry,
      description: str(out.description, 600),
      services,
      tone: str(out.tone, 80),
    };
  } catch {
    // A slower answer is worth having; a lost one is not. The caller keeps the
    // mechanical read, which is never worse than before this existed.
    return null;
  }
}

export default refineBrand;
