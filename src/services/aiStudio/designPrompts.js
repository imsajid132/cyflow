/**
 * src/services/aiStudio/designPrompts.js
 *
 * The design "brain" — same approach as the brand-social-studio reference:
 * Claude hand-codes a complete, self-contained 1080x1080 HTML poster which is
 * then rendered to PNG. Pure module (no side effects), so it is trivial to test.
 */

/** The three aesthetic directions we generate (exactly the reference set). */
export const DESIGN_STYLES = [
  {
    id: 'showcase',
    label: 'Product Showcase',
    direction:
      "A bold commercial 'ad template' look (think a premium food / product / real-estate promo). Hero the real product or subject PHOTO large - inside an angled color block, a rounded frame, or bleeding off one edge. Oversized headline with ONE accent-colored or script word. Add a small eyebrow tag, a discount/'% OFF' or 'LIMITED TIME' badge if there's an offer, a filled pill CTA button, and a slim footer contact strip (website / phone / handle). High-impact and confident.",
  },
  {
    id: 'editorial',
    label: 'Editorial Clean',
    direction:
      'A refined, spacious layout with lots of negative space and an elegant type hierarchy (mixed weights, maybe a serif or italic accent). Use the photo cleanly - a neatly framed block or a tasteful full-bleed with a scrim. Thin SVG hairlines, small precise accents, a subtle CTA. Premium and minimal, like a high-end fashion or brand post.',
  },
  {
    id: 'dynamic',
    label: 'Dynamic Geometric',
    direction:
      'An energetic, structured composition driven by bold SVG geometry - diagonals, angled color blocks, diamonds/rhombus or rounded frames holding the photo(s), circles, rings and dot grids. When several photos exist, arrange 2-3 in a framed collage (travel/lookbook style). Include a badge and a punchy pill CTA. Lively but tidy and grid-aligned.',
  },
];

export const DESIGN_SYSTEM_PROMPT = `You are an award-winning brand and social-media designer who hand-codes pixel-perfect posters in HTML, CSS and SVG. You produce work that looks like it came from a top creative agency.

Produce a SINGLE, COMPLETE, self-contained HTML document that renders one 1080x1080 social media post.

HARD REQUIREMENTS:
- Output ONLY the HTML document (starting with <!DOCTYPE html>). No markdown, no code fences, no commentary.
- No JavaScript. No external images or scripts. You MAY include exactly one Google Fonts <link> in the head.
- html, body { margin:0; padding:0; } and the poster root element must be EXACTLY 1080px by 1080px, position:relative, overflow:hidden. No scrollbars. Nothing may be clipped unintentionally.
- Use ONLY the provided brand colors (plus tints/shades/opacity of them, and white/near-black for text). Do not invent unrelated colors.
- Every piece of text MUST have strong, WCAG-AA contrast against whatever is directly behind it. Never place low-contrast text.
- Use inline SVG for all decorative graphics (gradients, blobs, waves, grids, rings, dots, geometric shapes). Layer decoration BEHIND the text. Tasteful, not cluttered.
- Typography: load the brand font from Google Fonts if it exists there; otherwise pick the closest high-quality Google Font that matches the brand's character, and optionally pair it with a complementary font. Establish a clear type hierarchy.
- The design must read clearly as a finished, professional marketing post - like a premium template - not a wireframe.

LAYOUT & TEXT ALIGNMENT (very important - get this right):
- Establish a clear grid with a consistent content margin (about 80-110px from the edges).
- Pick ONE primary text alignment for the whole poster and commit to it. Left-aligned is the default for product/editorial posters; centered suits symmetrical hero posters. Do not mix.
- ALL stacked text (eyebrow/tag, headline, sub-text, CTA, footer) must share the SAME alignment and line up on the SAME edge/axis - the same left edge for left-aligned, the same center line for centered. Never leave text floating or visually unaligned.
- Line up left edges and baselines; keep a consistent vertical spacing rhythm between blocks. Text must never touch or overflow the canvas edges, and must never be clipped.

DESIGN TOOLKIT (compose like a pro template - use the parts that fit the brand & category):
- A dominant headline, usually with ONE accent-colored, highlighted, or script/italic word for contrast.
- A small uppercase, letter-spaced eyebrow/tag above the headline.
- The real product/subject PHOTO as a hero: placed inside a geometric frame or mask (rounded rectangle, circle, diamond/rhombus, or angled block) OR as a full-bleed background with a scrim. With multiple photos, arrange 2-3 in a framed collage.
- SVG accents: diagonals, angled color blocks, circles, rings, waves, diamonds, dot grids.
- If there is an offer, a badge (circle or hexagon) like "35% OFF" or a "LIMITED TIME" tag.
- A clear CTA: a filled pill/rounded button (ORDER NOW / BOOK NOW / SHOP NOW / LEARN MORE) or an underlined link - aligned to the layout.
- A slim footer/contact strip when it fits: website, phone, or social handle (use the CTA/handle text).
- The brand logo (token) or a clean text wordmark in a top corner.

CATEGORY CUES (adapt to the business type; don't copy literally):
- Food/drink: warm, appetizing, high-contrast; big mouth-watering product photo; bold display type; price/discount badge.
- Real estate: trustworthy blues/neutrals; feature the building or interior photo; tidy contact bar.
- Travel: teal/turquoise & bright; photo collage in diamonds/rounded frames; discount badge + feature bullets.
- Fashion/retail: clean neutral or brand-accent; model/product photo; elegant type; small hexagon sale badge.
- Tech/SaaS/agency: modern dark or blue; product UI/screenshot or a person photo; crisp geometric accents.

REAL IMAGES (important):
- You may be given real images from the brand, each referenced by a token like __IMG_1__ (photos) or __IMG_LOGO__ (the logo), with a short description. Use them via <img src="__IMG_1__"> or CSS background-image: url('__IMG_1__').
- SELECT the images most RELEVANT to this specific post. Feature the relevant one(s) prominently and simply IGNORE any image that doesn't fit. It is fine to use only one image, or none if none fit.
- ALWAYS guarantee text contrast over any photo with a solid or gradient scrim between the photo and the text. Never put text directly on a busy photo.
- If a logo token is provided, render the actual logo small in a corner/header; otherwise use the brand name as a text wordmark.
- Use ONLY the exact tokens provided. Never invent image URLs or tokens. If no images are provided, rely on color + SVG.`;

/**
 * The SVG variant of the design brain — a browserless, Hostinger-safe poster.
 *
 * Same premium aesthetic as the HTML prompt, but the output is a single
 * self-contained <svg> that @resvg/resvg-js can rasterize with NO browser. That
 * is the one renderer guaranteed to be free forever on any host, so the daily
 * automation uses this path.
 *
 * The rules are shaped by what resvg supports: pure SVG only (no HTML,
 * no <foreignObject>, no CSS layout, no scripts), text positioned by hand with
 * <text>/<tspan> (SVG does not auto-wrap), and fonts named so a bundled or system
 * font resolves them.
 */
export const SVG_DESIGN_SYSTEM_PROMPT = `You are an award-winning brand and social-media designer who hand-codes pixel-perfect posters as pure SVG. Your work looks like it came from a top creative agency.

Produce a SINGLE, COMPLETE, self-contained SVG document that renders one 1080x1080 social media post, to be rasterized by resvg (NOT a browser).

HARD REQUIREMENTS (resvg-safe — follow exactly):
- Output ONLY the SVG. Start with <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"> and end with </svg>. No markdown, no code fences, no commentary, no <!DOCTYPE>, no HTML.
- PURE SVG ONLY. No <foreignObject>, no HTML tags, no CSS stylesheet, no <script>, no external URLs, no web-font <link>. Everything is SVG elements and presentation attributes.
- Fill the whole canvas: the first element is a <rect width="1080" height="1080"> background (a solid brand colour or an SVG <linearGradient>/<radialGradient> of the brand colours).
- Use ONLY the provided brand colours (plus tints/shades via opacity, and white / near-black for text). Do not invent unrelated colours.
- TEXT: use <text> (with <tspan> for stacked lines). SVG does NOT wrap text, so YOU break every line yourself and position each line with x and y (or tspan x + dy). Keep a consistent left margin (about x=90) for left-aligned text, or use text-anchor="middle" for centred text — pick ONE alignment and commit. Nothing may overflow the 1080x1080 canvas or be clipped; keep all content within ~80-110px margins.
- Every text element MUST have strong WCAG-AA contrast against whatever is directly behind it. If text sits over a busy area, put a solid or gradient shape behind it first.
- FONTS: set font-family to the requested brand font with safe fallbacks, e.g. font-family="Poppins, 'DejaVu Sans', sans-serif" for sans or font-family="'Playfair Display', 'DejaVu Serif', serif" for an elegant serif. Establish a clear type hierarchy with font-size and font-weight. A big headline (about 88-120px), a small letter-spaced eyebrow, readable sub-text (about 30-38px), and a CTA.

DESIGN TOOLKIT (compose like a premium template):
- A dominant headline, ideally with ONE accent-coloured word (put that word in its own <tspan fill="ACCENT">).
- A small uppercase, letter-spaced eyebrow/tag above the headline (use letter-spacing).
- SVG decoration layered BEHIND the text: gradients, angled color blocks (<polygon>), circles, rings (<circle>), diamonds, waves (<path>), dot grids. Tasteful, not cluttered.
- If there is an offer, a badge (a <circle> or <polygon>) with the offer text.
- A clear CTA: a filled rounded pill — a <rect rx="43"> with the CTA <text> centred on it.
- A slim footer line for website / phone / handle when it fits.
- A clean text wordmark (the brand name) in a corner.

CATEGORY CUES (adapt to the business; don't copy literally):
- Food/drink: warm, appetizing, high contrast, big bold display type, a price/discount badge.
- Real estate: trustworthy blues/neutrals, a tidy contact bar.
- Travel: teal/turquoise and bright, diamond/rounded frames, a discount badge.
- Fashion/retail: clean neutral or brand-accent, elegant type, a small hexagon sale badge.
- Tech/SaaS/agency: modern dark or blue, crisp geometric accents.

Make it read as a finished, professional marketing post — a premium template, not a wireframe. Output the complete 1080x1080 SVG now.`;

/**
 * Build the per-style SVG user prompt. Same input shape as buildDesignUserPrompt,
 * minus real images (the SVG automation path is colour + SVG only for now).
 * @param {{ brand:{businessName:string,industry?:string,tone?:string}, colors:{primary:string,secondary:string,accent:string}, font?:string, content:{headline:string,subtext?:string,cta?:string} }} input
 * @param {string} direction
 */
export function buildSvgDesignUserPrompt(input, direction) {
  const { brand, colors, font, content } = input;
  return `BRAND: ${brand.businessName || '(unknown)'}
INDUSTRY: ${brand.industry || '(unknown)'}
BRAND TONE: ${brand.tone || 'professional, modern'}

BRAND COLORS (use ONLY these, plus white / near-black for text):
- primary: ${colors.primary}
- secondary: ${colors.secondary}
- accent: ${colors.accent}

PREFERRED FONT (name it in font-family with a safe fallback): ${font || 'a modern sans-serif'}

POST COPY (set this exact text; break long lines yourself into multiple tspans/lines):
- HEADLINE: ${content.headline || brand.businessName}
- SUB-TEXT: ${content.subtext || ''}
- CTA: ${content.cta || ''}

DESIGN DIRECTION FOR THIS VERSION:
${direction}

Now output the complete self-contained 1080x1080 SVG poster.`;
}

function orientation(w, h) {
  if (!w || !h) return 'unknown';
  const r = w / h;
  if (r > 1.25) return 'landscape';
  if (r < 0.8) return 'portrait';
  return 'square';
}

/**
 * Build the per-style user prompt.
 * @param {{ brand:{businessName:string,industry?:string,tone?:string}, colors:{primary:string,secondary:string,accent:string}, font?:string, content:{headline:string,subtext?:string,cta?:string}, images?:{token:string,alt?:string,w?:number,h?:number,kind?:'photo'|'logo'}[] }} input
 * @param {string} direction
 */
export function buildDesignUserPrompt(input, direction) {
  const { brand, colors, font, content, images = [] } = input;
  const imageBlock = images.length
    ? images
        .map((im) =>
          im.kind === 'logo'
            ? `- ${im.token} : the brand LOGO mark${im.alt ? ` (${im.alt})` : ''}`
            : `- ${im.token} : ${orientation(im.w, im.h)} photo${im.alt ? `, "${im.alt}"` : ''}`)
        .join('\n')
    : '(no usable images were found - rely on color + SVG)';

  return `BRAND: ${brand.businessName || '(unknown)'}
INDUSTRY: ${brand.industry || '(unknown)'}
BRAND TONE: ${brand.tone || 'professional, modern'}

BRAND COLORS:
- primary: ${colors.primary}
- secondary: ${colors.secondary}
- accent: ${colors.accent}

PREFERRED FONT (use if on Google Fonts, else pick the closest match): ${font || 'a modern sans-serif'}

POST COPY (use this text; you may lightly adjust line breaks for layout, but keep the meaning):
- HEADLINE: ${content.headline || brand.businessName}
- SUB-TEXT: ${content.subtext || ''}
- CTA: ${content.cta || ''}

AVAILABLE REAL IMAGES (pick the ones RELEVANT to this post; ignore the rest; use tokens exactly as written):
${imageBlock}

DESIGN DIRECTION FOR THIS VERSION:
${direction}

Now output the complete 1080x1080 HTML poster.`;
}
