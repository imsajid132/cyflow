/**
 * src/services/aiStudio/captionService.js
 *
 * Caption written by LOOKING at the finished poster (Claude vision). Follows the
 * Cyflow copy rules: real multi-paragraph posts, platform-specific voice, no em
 * or en dashes, no invented facts.
 */
import { askClaude, parseJsonFromModel } from './claudeClient.js';

const CAPTION_SYSTEM = `You are a senior social-media copywriter. You are shown a finished 1080x1080 social media poster for a business. Write ready-to-post caption copy that matches the poster's message and the brand's voice.

Rules:
- Facebook and Instagram: proper post copy, 2 to 4 short paragraphs, about 100 to 180 words, warm and specific to this business.
- Threads: shorter and punchier, about 40 to 100 words. NOT a trimmed version of the Instagram post, write it fresh.
- NEVER use em dashes or en dashes. Use a period, comma, colon, parentheses, or a normal hyphen where grammar needs it.
- Never invent statistics, prices, guarantees, or results that are not shown on the poster or given to you. If a fact is not provided, leave it out.
- At most 3 relevant hashtags per platform, at the very end. No hashtags inside the sentences.
- Do not describe the image ("this poster shows..."). Write as the brand speaking to its audience.

Return ONLY a single JSON object, no markdown, no commentary:
{ "facebook": "...", "instagram": "...", "threads": "..." }`;

/**
 * @param {{ pngBuffer:Buffer, brand:{businessName:string,industry?:string,tone?:string}, content:{headline:string,subtext?:string,cta?:string} }} args
 * @returns {Promise<{facebook:string, instagram:string, threads:string}>}
 */
export async function generateCaptionsFromImage({ pngBuffer, brand, content }) {
  const userText = `BUSINESS: ${brand.businessName || '(unknown)'}
INDUSTRY: ${brand.industry || '(unknown)'}
BRAND TONE: ${brand.tone || 'professional, modern'}

The attached image is the FINISHED social poster for this business. Its on-poster message:
- HEADLINE: ${content.headline || ''}
- SUB-TEXT: ${content.subtext || ''}
- CTA: ${content.cta || ''}

Write caption copy for each platform, grounded in what the poster communicates and the brand voice. Return ONLY the JSON object.`;

  const raw = await askClaude({
    system: CAPTION_SYSTEM,
    userText,
    images: [{ mediaType: 'image/png', dataBase64: pngBuffer.toString('base64') }],
    maxTokens: 1500,
  });

  const obj = parseJsonFromModel(raw) || {};
  const clean = (s) => String(s || '').replace(/[—–]/g, '-'); // strip stray em/en dashes as a safety net
  return {
    facebook: clean(obj.facebook),
    instagram: clean(obj.instagram),
    threads: clean(obj.threads),
  };
}
