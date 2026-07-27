/**
 * src/services/aiStudio/posterPhoto.js
 *
 * A photograph from the business's own website, made safe to put on a poster.
 *
 * WHY. The posters were colour and type only, and next to a real one they
 * looked like placeholders. The thing that makes a small business's post look
 * like the business is a photograph OF that business: the brownstone they
 * restored, the shop, the crew. Those pictures are already on their website and
 * the reader already found every one of them.
 *
 * WHY IT IS EMBEDDED. The renderer is resvg, not a browser: it will not fetch a
 * remote URL from inside an SVG. The bytes have to be in the document, as a
 * `data:` URI, or the poster renders with a hole in it. (Verified: resvg 2.6.2
 * draws embedded JPEG and PNG.)
 *
 * WHY THIS IS THE CAREFUL PART. Fetching a URL a user supplied, server-side, is
 * the shape of a server-side request forgery. So the host is resolved and every
 * resolved address checked before the connection, every redirect is re-checked
 * rather than followed blindly, the body is capped as it arrives rather than
 * after, and the bytes must actually BE an image by their own magic number
 * regardless of what the server claimed. A picture that fails any of that is
 * simply not used: a poster without a photograph is worse-looking, and a poster
 * with someone's internal network in it is a breach.
 */

import { assertPublicHost, isBlockedHostname } from '../../utils/urlSafety.js';

/**
 * 4MB. Large enough for a full-bleed photograph from a normal website, small
 * enough that seven of them cannot exhaust a shared host's memory. Base64 adds
 * a third on top, and that string goes through the SVG parser.
 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** How long one picture may take before the poster goes ahead without it. */
const TIMEOUT_MS = 12_000;

/** Redirect hops allowed. Each one is re-validated; none is followed blindly. */
const MAX_REDIRECTS = 3;

/**
 * What resvg will actually draw, decided by the file's own first bytes.
 *
 * A `Content-Type` header is what a server SAYS. This is what the file IS, and
 * only these two are proven to render.
 */
function sniffImageType(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Read a response body, stopping the moment it goes over the cap. */
async function readCapped(response, maxBytes) {
  // A declared length over the cap is refused before a single chunk is read.
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

/**
 * Why a picture was not used. Short, safe, and written for a person: this
 * reaches the screen, because a poster that quietly has no photograph is
 * indistinguishable from a poster that was never meant to have one, and the
 * owner cannot fix what nobody tells them about.
 */
export const PHOTO_SKIP = {
  NO_PICTURE: 'no_picture',
  UNREACHABLE: 'unreachable',
  BLOCKED: 'blocked',
  TOO_LARGE: 'too_large',
  UNSUPPORTED_FORMAT: 'unsupported_format',
};

/** The same reasons, in words the owner of a small business can act on. */
export const PHOTO_SKIP_MESSAGE = {
  [PHOTO_SKIP.NO_PICTURE]: 'No photograph was ticked for this post.',
  [PHOTO_SKIP.UNREACHABLE]: 'That picture could not be downloaded from your website.',
  [PHOTO_SKIP.BLOCKED]: 'That picture is at an address this app will not open.',
  [PHOTO_SKIP.TOO_LARGE]: 'That picture is too large to put on a poster.',
  [PHOTO_SKIP.UNSUPPORTED_FORMAT]: 'That picture is in a format the poster renderer cannot draw (only JPEG and PNG work).',
};

/**
 * Fetch one picture and return it ready to embed, with the reason when it is not.
 *
 * NEVER throws. A missing photograph makes a poster plainer; an exception here
 * would lose the whole post, and the post is the thing the user asked for.
 *
 * @param {string} url
 * @param {{ maxBytes?:number, fetchImpl?:Function, lookup?:Function }} [deps]
 * @returns {Promise<{ photo:{dataUri:string,mime:string,bytes:number}|null, reason:string|null }>}
 */
export async function fetchPosterPhoto(url, { maxBytes = MAX_PHOTO_BYTES, fetchImpl = fetch, lookup } = {}) {
  const no = (reason) => ({ photo: null, reason });
  try {
    let current = new URL(String(url));

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (current.protocol !== 'https:' && current.protocol !== 'http:') return no(PHOTO_SKIP.BLOCKED);
      // Credentials in a URL are never accepted, here or anywhere.
      if (current.username || current.password) return no(PHOTO_SKIP.BLOCKED);
      if (isBlockedHostname(current.hostname)) return no(PHOTO_SKIP.BLOCKED);
      // Resolve first: a public-looking name can answer with a private address.
      // eslint-disable-next-line no-await-in-loop
      await assertPublicHost(current.hostname, { lookup });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await fetchImpl(current.toString(), {
          // Followed by hand so every hop goes through the checks above.
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'image/jpeg,image/png,image/*;q=0.8' },
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location');
        if (!location || hop === MAX_REDIRECTS) return no(PHOTO_SKIP.UNREACHABLE);
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) return no(PHOTO_SKIP.UNREACHABLE);

      // eslint-disable-next-line no-await-in-loop
      const buf = await readCapped(response, maxBytes);
      if (!buf) return no(PHOTO_SKIP.TOO_LARGE);
      if (buf.length < 100) return no(PHOTO_SKIP.UNREACHABLE);

      const mime = sniffImageType(buf);
      /*
       * WebP and AVIF are the common answer here, and they are a real dead end
       * rather than an oversight: resvg draws neither (verified — both render
       * as nothing at all), so accepting one would put a hole in the poster
       * instead of a picture.
       */
      if (!mime) return no(PHOTO_SKIP.UNSUPPORTED_FORMAT);

      return {
        photo: { dataUri: `data:${mime};base64,${buf.toString('base64')}`, mime, bytes: buf.length },
        reason: null,
      };
    }
    return no(PHOTO_SKIP.UNREACHABLE);
  } catch {
    // Including the ValidationError assertPublicHost throws for a private
    // address. Refusing a picture is never worth failing a post over.
    return no(PHOTO_SKIP.UNREACHABLE);
  }
}

/**
 * The photograph for one day of a week.
 *
 * Rotates, so seven posts do not all carry the same picture: a week that
 * repeats one photograph seven times looks more automated than one with no
 * photographs at all. Only the pictures the user left TICKED are eligible, and
 * only ones the reader classified as photographs — a logo stretched across a
 * poster background is a mistake nobody would make on purpose.
 *
 * @param {{url?:string, kind?:string, chosen?:boolean}[]} images
 * @param {number} day 1-based
 */
export function photoForDay(images, day) {
  const usable = (Array.isArray(images) ? images : [])
    .filter((im) => im && im.url && im.chosen !== false && (im.kind || 'photo') === 'photo');
  if (!usable.length) return null;
  const i = (Math.max(1, Number(day) || 1) - 1) % usable.length;
  return usable[i];
}

export default { fetchPosterPhoto, photoForDay, PHOTO_SKIP, PHOTO_SKIP_MESSAGE, MAX_PHOTO_BYTES };
