/**
 * src/services/aiStudio/weekPlanner.js
 *
 * A week of posts, decided in one go.
 *
 * The product is explicit that the user does not brief the AI: there is no tone
 * box, no topic box and no style picker, and Claude decides what a week should
 * say from the brand it just read. This is where that decision is made.
 *
 * WHY ALL SEVEN AT ONCE. Asking seven separate times "what should a post for
 * this business say?" produces seven answers to the same question, and they
 * converge — the same service, the same angle, the same opening, phrased a
 * little differently each time. That is the duplicate problem the product bans
 * outright, and no amount of comparing finished posts fixes it after the fact.
 * Deciding the WEEK in one call makes difference a requirement of the plan
 * rather than an accident of generation: Claude is told to cover different
 * services, different angles and different jobs, and can see all seven while it
 * does.
 *
 * Each idea then becomes one post: its own poster and its own copy for each
 * platform. Nothing here publishes.
 */

import { askClaude, parseJsonFromModel } from './claudeClient.js';

/** How many posts a week holds. One a day. */
export const WEEK_LENGTH = 7;

const SYSTEM = `You are the content strategist for a small business. You are given everything known about the brand, and you plan a WEEK of social posts — one per day.

Return a single JSON object, no markdown and no commentary:

{ "posts": [ { "day": 1, "job": "...", "angle": "...", "service": "...", "why": "..." } ] }

Rules:
- Exactly ${WEEK_LENGTH} posts, day 1 through ${WEEK_LENGTH}.
- Every post must do a DIFFERENT job. A week that is seven versions of "we do good work" is a failed week. Spread across the jobs that suit this business: introduce a service, answer a question customers actually ask, show proof of work done, explain how something is decided, warn about a common mistake, mark a season or a moment, invite an enquiry.
- Every post must use a DIFFERENT angle, and where the business has several services, cover several of them. Never repeat a service two days running.
- "service": the one service this post is about, from the brand's own list, or empty when the post is not about a specific service.
- "angle": one sentence saying what THIS post says that the others do not.
- "why": one short sentence on who it is for and what it should make them do.
- Ground everything in the brand you were given. Never invent a statistic, a price, an offer, a guarantee or a result. If the brand did not say it, it does not go in the plan.`;

/** The brand, as the strategist needs to see it. */
function brandBrief(brand = {}) {
  const lines = [
    `BUSINESS: ${brand.businessName || '(unknown)'}`,
    `INDUSTRY: ${brand.industry || '(unknown)'}`,
    `WHAT IT DOES: ${brand.description || '(not stated)'}`,
  ];
  if (brand.services?.length) {
    lines.push('', 'SERVICES:');
    for (const s of brand.services) lines.push(`- ${s}`);
  }
  const place = [brand.city, brand.region, brand.country].filter(Boolean).join(', ');
  if (place) lines.push('', `WHERE: ${place}`);
  if (brand.tone) lines.push(`BRAND TONE: ${brand.tone}`);
  if (brand.imageCount) lines.push(`PHOTOGRAPHS AVAILABLE: ${brand.imageCount}`);
  return lines.join('\n');
}

/**
 * Ask Claude to plan the week.
 *
 * @param {object} brand the corrected brand from the studio screen
 * @param {{ avoid?: string[] }} [opts] angles already used, so a re-plan or a
 *        later week does not repeat what this business has already posted
 * @returns {Promise<{day:number, job:string, angle:string, service:string, why:string}[]>}
 * @throws when the model cannot be reached or returns nothing usable — a week
 *         built from a failed plan would be seven near-identical posts, which is
 *         worse than telling the user to try again.
 */
export async function planWeek(brand, { avoid = [] } = {}) {
  const parts = [brandBrief(brand)];
  if (avoid.length) {
    parts.push('', 'ALREADY POSTED — do not repeat these angles:');
    for (const a of avoid.slice(0, 30)) parts.push(`- ${a}`);
  }
  parts.push('', `Plan the ${WEEK_LENGTH} posts now. Return ONLY the JSON object.`);

  const raw = await askClaude({ system: SYSTEM, userText: parts.join('\n'), maxTokens: 2000 });
  const parsed = parseJsonFromModel(raw) || {};
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const plan = posts.slice(0, WEEK_LENGTH).map((p, i) => ({
    day: Number.isInteger(p?.day) && p.day >= 1 && p.day <= WEEK_LENGTH ? p.day : i + 1,
    job: str(p?.job, 60),
    angle: str(p?.angle, 300),
    service: str(p?.service, 80),
    why: str(p?.why, 300),
  })).filter((p) => p.angle);

  if (plan.length < WEEK_LENGTH) {
    throw new Error(`The week plan came back with ${plan.length} of ${WEEK_LENGTH} posts.`);
  }
  return plan.sort((a, b) => a.day - b.day);
}

export default planWeek;
