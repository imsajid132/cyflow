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
export const SVG_DESIGN_SYSTEM_PROMPT = `You are a senior brand designer at a top agency. You hand-code 1080x1080 social posters as pure SVG, and your work is judged against professional agency output.

Produce ONE complete, self-contained SVG document, to be rasterized by resvg (NOT a browser).

=== THE GRAMMAR (this is not a suggestion) ===

Ten professional reference posters from two unrelated brands were studied side by side. Every one of them uses the same six-part structure, top to bottom. Follow it. It is what separates a designed poster from a coloured slide.

1. HEADER BAND. The brand name top-left as a small letterspaced wordmark. A short category pill top-right (a <rect rx="20"> with 2-4 uppercase words inside, e.g. the post's topic). A hairline (<line> or 1px <rect> at ~12% opacity) under the whole band.
2. EYEBROW. A short thick rule (a <rect> about 44x5) followed by ONE letterspaced uppercase word or short phrase. The rule alone is acceptable.
3. HEADLINE. The largest thing on the canvas. TWO lines by default, three at the absolute most. Tight leading. Exactly ONE emphasis inside it: a single <tspan> in the accent colour, or a single dimmed <tspan> at ~55% opacity. Never two emphases.
4. ONE CONTENT BLOCK — and only one. This is the evidence for the headline and the part that makes the poster worth looking at. Pick the ONE that fits what you were given:
   - CHECKLIST: 3 to 5 rows. Each row is a small rounded-square chip (a <rect rx="10">, ~44x44) holding a number or a tick, then a bold title, and OPTIONALLY a smaller line of detail under it at ~60% opacity. A row of bare phrases is not a checklist. If you were given supporting points, show EVERY one of them: a list that silently drops its last item looks like a mistake, because it is one.
   - TWO COLUMNS: two equal <rect rx="18"> cards side by side, the favoured one marked by a border in the accent colour and a small label chip. 3-4 short rows per side, separated by hairlines.
   - HERO FACT: one enormous number or short phrase at 180-230px, with a plain, quieter label beneath it that defers to it.
   - QUIET: on a photograph or a rich gradient, the block may be one supporting line at ~75% opacity. Only then.
5. HAIRLINE, then FOOTER. A two-sided lockup on one line: the website or phone on the LEFT, and a short call to action on the RIGHT. Never centred. The footer anchors the composition; without it the canvas floats.
6. THE SAFE AREA IS x FROM 80 TO 1000 AND y FROM 80 TO 1000. These are real numbers, not a guideline. Work them backwards:
   - The footer text baseline sits at y=985. NOTHING may have a y greater than 1000: the canvas ends at 1080 and anything past 1000 is cut off or touching the edge.
   - The footer hairline sits at y=930.
   - The content block ends by y=890.
   - The header wordmark baseline is y=118 and its hairline is y=150.
   Lay the poster out from both ends toward the middle. If the middle does not fit, make the headline smaller — never let the bottom run off.

=== WHAT MAKES IT LOOK PROFESSIONAL ===

- TWO COLOURS, IN VERY UNEQUAL PROPORTION. Roughly 80% field, 15% ink, 5% accent. A third colour appears only as one small chip, if at all. Three colours at equal weight looks amateur every time.
- HIERARCHY COMES FROM OPACITY, NOT MORE COLOURS. 100% for the headline, ~75% for support, ~45-55% for the eyebrow and footer. Use fill-opacity.
- EMPTY SPACE MUST NOT BE FLAT. A subtle gradient across the field, or a faint grid of lines at 4-6% opacity, makes emptiness read as intentional rather than unfinished.
- NOTHING IS DECORATIVE. Across ten professional references there is not one floating circle, blob, ring, diamond, wave or scattered shape. Every mark is a rule, a chip, a card, a tick, a hairline, or type. DO NOT ADD DECORATION. If a shape is not carrying information, delete it.
- The headline is a CLAIM that stands alone, not a title for the caption.

=== TYPE SCALE (against 1080) ===
- Hero number: 180-230px, weight 800.
- Headline: 62-104px by length, weight 700-800, sentence case, letter-spacing -0.01em, leading 1.0-1.12.
- Row/list title: 26-32px weight 600-700. Row detail: 20-24px weight 400 at ~60%.
- Support line: 27-30px weight 400 at ~75%.
- Eyebrow, pill, wordmark: 18-22px weight 700, UPPERCASE, letter-spacing 3-5px.
- Footer: 19-22px weight 600 at ~70%.

=== HARD TECHNICAL RULES (resvg — break one and it renders wrong) ===
- Output ONLY the SVG. Start <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080"> and end </svg>. No markdown, no fences, no commentary, no HTML.
- PURE SVG. No <foreignObject>, no CSS stylesheet, no <script>, no class attributes, no external URLs, no web fonts. Presentation attributes only.
- SVG DOES NOT WRAP TEXT. Break every line yourself into separate <text> or <tspan x="..." dy="..."> elements. A line you do not break runs off the canvas.
- Estimate width before you commit: at weight 700, a character is about 0.55x the font size. A 72px headline fits roughly 22 characters in 900px. If a line would exceed the safe width, break it earlier or drop the size.
- FONTS: EXACTLY TWO EXIST. "Inter" (sans) and "Playfair Display" (serif). Any other family renders as empty boxes. Write font-family="Inter, sans-serif" or font-family="Playfair Display, serif" and nothing else. Ignore the brand's preferred font if it is neither.
- Every piece of text must have strong contrast against what is directly behind it. Over a photograph or a busy gradient, put a solid or gradient scrim behind the text FIRST.
- Use ONLY the given brand colours, plus white and near-black as ink, plus opacity. Never invent a hue the business did not save.
- NEVER type an em dash or an en dash in any text you set. Use a period, a comma, a colon, parentheses, or a normal hyphen. This is a brand rule, not a preference.
- Set the text you were given. You may break lines and choose which word to emphasise; you may not rewrite the sentence or add one of your own.

Output the complete 1080x1080 SVG now, and nothing else.`;

/**
 * Added to the system prompt when a real photograph of the business is
 * available. The bytes are substituted for the token AFTER the model answers —
 * a model asked to emit base64 would either hallucinate it or spend the whole
 * response on it.
 */
export const SVG_PHOTO_RULES = `
=== YOU HAVE A REAL PHOTOGRAPH OF THIS BUSINESS ===

Write it EXACTLY as: <image xlink:href="{{PHOTO}}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
Use the literal text {{PHOTO}} as the href. Never write base64 data yourself. You may change x/y/width/height to place it, but keep preserveAspectRatio="xMidYMid slice" so it fills its box without distorting.

This photograph is the single biggest reason the poster will look like it belongs to this business rather than to a template. Use it as the FIELD:

- Full-bleed behind everything, or filling one confident region (the top 55%, or the right half). Not a small inset, and never a floating rounded thumbnail.
- IMMEDIATELY after the <image>, lay a scrim over it so type is readable: a <rect> filled with a <linearGradient> from the brand's darkest colour at 0.92 opacity where the text sits to 0.15 at the far end. Text over an unscrimmed photograph is unreadable, and you cannot see the photograph to check.
- Ink on the scrimmed area is white at 100 / 75 / 50 percent. The accent colour is still allowed for the eyebrow rule, the pill and one headline span.
- Keep the grammar above: header band, eyebrow, headline, ONE content block (on a photograph, "QUIET" is usually right), hairline, footer.
- Do NOT crop the photograph into a circle or a blob. A rectangle, or the whole canvas.`;

/**
 * Build the per-style SVG user prompt. Same input shape as buildDesignUserPrompt,
 * minus real images (the SVG automation path is colour + SVG only for now).
 * @param {{ brand:{businessName:string,industry?:string,tone?:string}, colors:{primary:string,secondary:string,accent:string}, font?:string, content:{headline:string,subtext?:string,cta?:string} }} input
 * @param {string} direction
 */
export function buildSvgDesignUserPrompt(input, direction) {
  const { brand, colors, font, content, hasPhoto = false, photoAlt = '' } = input;
  const points = Array.isArray(content?.points) ? content.points.filter(Boolean).slice(0, 5) : [];

  /*
   * The material for the content block. Without it the model has a headline and
   * a sub-line and nothing else, which is exactly how a poster ends up as a
   * coloured slide with two sentences on it — the failure the owner saw.
   */
  const blockMaterial = points.length
    ? `SUPPORTING POINTS for the content block (use these, do not invent others):\n${points.map((p) => `- ${p}`).join('\n')}`
    : `SUPPORTING POINTS: none were given. Use the QUIET block (one supporting line) rather than inventing list items.`;

  const facts = [
    brand.websiteUrl ? `WEBSITE (put this in the footer): ${String(brand.websiteUrl).replace(/^https?:\/\//, '').replace(/\/$/, '')}` : null,
    brand.phone ? `PHONE: ${brand.phone}` : null,
    brand.city ? `CITY: ${brand.city}` : null,
  ].filter(Boolean).join('\n');

  return `BRAND: ${brand.businessName || '(unknown)'}
INDUSTRY: ${brand.industry || '(unknown)'}
BRAND TONE: ${brand.tone || 'professional, modern'}
${facts}

BRAND COLOURS. Assign ROLES rather than using them equally:
- ${colors.primary} and ${colors.secondary} — one of these is the FIELD (the 80%).
- ${colors.accent} — the ACCENT. Small area only: the eyebrow rule, the pill, one headline span, a chip.
- White and near-black are always available as ink. Choose the ink that actually reads on your field.
Never use a colour that is not in this list.

PREFERRED FONT: ${font || 'either of the two'} — but ONLY "Inter" or "Playfair Display" exist. If the preferred font is neither, pick whichever of the two suits this brand.

POSTER TEXT (set this text; break the lines yourself):
- HEADLINE: ${content.headline || brand.businessName}
- SUPPORT LINE: ${content.subtext || ''}
- CALL TO ACTION (goes in the footer, right side): ${content.cta || ''}

${blockMaterial}
${hasPhoto ? `\nA REAL PHOTOGRAPH of this business is available${photoAlt ? ` ("${photoAlt}")` : ''}. Use it as described in the photograph rules.` : ''}

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
