/**
 * Public marketing pages — home, features, how-it-works, security, about,
 * contact, privacy, terms. One module, selected by `view`, so a visitor only
 * downloads the marketing bundle once.
 *
 * Every claim here is deliberately accurate: only the three supported platforms,
 * no invented metrics, testimonials, customer counts or certifications, and no
 * claim that live publishing has been verified. Publishing availability is
 * described honestly as depending on the visitor's own connected Meta accounts
 * and approved permissions.
 */

import { el } from '../ui.js';
import { publicHeader, publicFooter } from '../components/publicChrome.js';

const SUPPORTED = ['Facebook Pages', 'Instagram Professional', 'Threads'];

function hero(title, sub, actions = true) {
  return el('section', { className: 'pub-hero' }, [
    el('div', { className: 'pub-container' }, [
      el('span', { className: 'pub-eyebrow', text: 'Cyflow Social' }),
      el('h1', { className: 'pub-h1', text: title }),
      el('p', { className: 'pub-lead', text: sub }),
      actions ? el('div', { className: 'pub-hero-cta' }, [
        el('a', { className: 'btn btn-primary', text: 'Get started', attrs: { href: '/register', 'data-link': '' } }),
        el('a', { className: 'btn btn-secondary', text: 'See how it works', attrs: { href: '/how-it-works', 'data-link': '' } }),
      ]) : null,
    ]),
  ]);
}

function section(title, children, opts = {}) {
  return el('section', { className: `pub-section${opts.alt ? ' pub-section-alt' : ''}` }, [
    el('div', { className: 'pub-container' }, [
      title ? el('h2', { className: 'pub-h2', text: title }) : null,
      opts.lead ? el('p', { className: 'pub-section-lead', text: opts.lead }) : null,
      ...children,
    ]),
  ]);
}

function featureGrid(items) {
  return el('div', { className: 'pub-grid' }, items.map(([title, body]) => el('div', { className: 'pub-card' }, [
    el('h3', { className: 'pub-card-title', text: title }),
    el('p', { className: 'pub-card-body', text: body }),
  ])));
}

function platformRow() {
  return el('div', { className: 'pub-platforms' }, SUPPORTED.map((p) => el('span', { className: 'pub-platform-chip', text: p })));
}

function bullets(items) {
  return el('ul', { className: 'pub-list' }, items.map((t) => el('li', { text: t })));
}

// --- individual pages ------------------------------------------------------

function home() {
  return [
    hero('Social content that is planned, written and published with intent.',
      'Cyflow Social helps small teams and agencies plan a week of content, write each platform separately, and publish to Facebook Pages, Instagram Professional and Threads — with durable background jobs, retries and honest status.'),
    section(null, [platformRow()], { alt: true }),
    section('Everything you need to run social content', [
      featureGrid([
        ['Platform-specific copy', 'Write a distinct post for each platform. Editing Threads never changes Instagram; each has its own copy, hashtags and length guidance.'],
        ['Manual drafts and scheduling', 'Save a draft, schedule it for an exact local time, or publish now. Optimistic saving means two tabs never overwrite each other.'],
        ['Rolling automations', 'Keep a buffer of future content topped up automatically on the weekdays and times you choose, in your timezone.'],
        ['Durable publishing', 'Publishing runs as background jobs with retries and reconciliation, so an uncertain result is checked, never blindly re-sent.'],
        ['Media library', 'Upload and reuse images, with alt text and delete protection for anything still in use.'],
        ['Your own AI keys', 'Optional AI help uses your own OpenAI credentials, encrypted at rest. Manual writing works without any AI.'],
      ]),
    ]),
    section('Built to be honest about what happens', [
      bullets([
        'Per-target status: one account succeeding never hides another failing.',
        'Publishing availability depends on your connected Meta accounts and approved app permissions.',
        'Nothing is sent to a provider until you connect an eligible account and publishing is enabled.',
      ]),
      el('div', { className: 'pub-cta-row' }, [
        el('a', { className: 'btn btn-primary', text: 'Create your account', attrs: { href: '/register', 'data-link': '' } }),
      ]),
    ], { alt: true }),
  ];
}

function features() {
  return [
    hero('Features', 'A focused toolset for planning, writing and publishing social content — without the noise.', false),
    section('Planning', [featureGrid([
      ['Auto content planner', 'Generate a structured week from your brand, pillars and cadence, then review each item before anything is scheduled.'],
      ['Weekly board', 'See the week at a glance, edit each platform independently, approve, and schedule.'],
    ])]),
    section('Writing', [featureGrid([
      ['Independent per-platform copy', 'Facebook, Instagram and Threads each get their own post copy and hashtags, with length guidance per platform.'],
      ['Revision history', 'Regeneration preserves your manual edits; a history lets you see and restore earlier copy for planner content.'],
      ['Optional AI assistance', 'Use your own OpenAI key to draft or refine a single platform. Manual writing never requires it.'],
    ])], { alt: true }),
    section('Publishing', [featureGrid([
      ['Save, schedule or publish now', 'Three explicit actions. Publish Now enqueues durable jobs and shows an honest queued state.'],
      ['Retries and reconciliation', 'Transient failures retry with backoff; an uncertain result is reconciled against the provider, never duplicated.'],
      ['Target-level status', 'Every account is tracked on its own, with clear reasons when something needs attention.'],
    ])]),
    section('Media and accounts', [featureGrid([
      ['Secure media library', 'Upload, validate, reuse and protect images; alt text is first-class.'],
      ['Connected Meta accounts', 'Connect Facebook Pages, Instagram Professional and Threads. Personal profiles are not supported.'],
    ])], { alt: true }),
  ];
}

function howItWorks() {
  const steps = [
    ['Create your account', 'Sign up and tell Cyflow about your business and brand.'],
    ['Add your keys (optional)', 'Add your own OpenAI key for AI help, and HCTI credentials for generated designs. Both are optional and encrypted.'],
    ['Connect supported accounts', 'Connect your Facebook Pages, Instagram Professional and Threads accounts.'],
    ['Plan or write', 'Generate a weekly plan, or write a post manually in Create Post.'],
    ['Edit each platform', 'Tune copy and hashtags per platform; choose or upload an image.'],
    ['Save, schedule or publish', 'Save a draft, schedule for a local time, or publish now through durable jobs.'],
    ['Review status', 'Watch per-target status in the Queue and Calendar, with clear reasons for anything that needs attention.'],
  ];
  return [
    hero('How it works', 'From a blank draft to published content, with honest status at every step.', false),
    section(null, [
      el('ol', { className: 'pub-steps' }, steps.map(([t, b], i) => el('li', { className: 'pub-step' }, [
        el('span', { className: 'pub-step-num', text: String(i + 1) }),
        el('div', {}, [el('h3', { className: 'pub-card-title', text: t }), el('p', { className: 'pub-card-body', text: b })]),
      ]))),
    ]),
    section('Good to know', [bullets([
      'Manual writing works without OpenAI; uploaded media works without HCTI.',
      'A background worker handles queued work, so publishing continues while your browser is closed.',
      'Provider permissions and account eligibility affect what can actually be published.',
    ])], { alt: true }),
  ];
}

function security() {
  return [
    hero('Security', 'Your credentials and content are handled with care and clear boundaries.', false),
    section('How we protect your data', [featureGrid([
      ['Per-user encrypted credentials', 'Your OpenAI and HCTI keys and provider tokens are encrypted at rest and never shown back to you or logged.'],
      ['Ownership isolation', 'Every request is scoped to your account in the database and in service logic; another user can never reach your data.'],
      ['Server-side provider calls', 'The browser never calls a social provider directly. Publishing happens on the server, as background jobs.'],
      ['Private media', 'Uploaded images are validated and served through a controlled route by opaque token, not a public file path.'],
      ['Safe history', 'Activity and publish history store safe fields only — never tokens, raw provider responses, or storage keys.'],
      ['A publishing safety switch', 'Live publishing is off by default and gated by an explicit server flag, so nothing goes out until you intend it to.'],
    ])]),
    section(null, [
      el('p', { className: 'pub-fineprint', text: 'We do not claim SOC 2, ISO 27001, HIPAA, PCI or penetration-test certification. This page describes the controls actually built into the product.' }),
    ], { alt: true }),
  ];
}

function about() {
  return [
    hero('About Cyflow Social', 'A focused tool for the people who actually do the social work.', false),
    section(null, [
      el('p', { className: 'pub-prose', text: 'Cyflow Social exists to make consistent, honest social publishing manageable for small teams and agencies. It is built around a simple belief: each platform deserves its own post, planning should be quick, and the tool should never pretend something happened that did not.' }),
      el('p', { className: 'pub-prose', text: 'The product supports Facebook Pages, Instagram Professional and Threads. It does not chase every network, and it does not invent numbers. What you see in the app reflects real state — real drafts, real schedules, real per-account status.' }),
    ]),
  ];
}

function contact() {
  return [
    hero('Contact', 'Questions, feedback, or help getting set up.', false),
    section(null, [
      el('p', { className: 'pub-prose', text: 'The best way to reach us is by email. We read every message.' }),
      el('p', { className: 'pub-prose' }, [
        el('a', { className: 'pub-mail', text: CONTACT_EMAIL, attrs: { href: `mailto:${CONTACT_EMAIL}` } }),
      ]),
      el('p', { className: 'pub-fineprint', text: 'An in-app contact form is not available yet, so this page does not pretend to send one. Email reaches us directly.' }),
    ]),
  ];
}

/**
 * The privacy policy and terms.
 *
 * These are read by people deciding whether to trust the service with their
 * business's social accounts, and by Meta's reviewers deciding whether to grant
 * the permissions that make the service work at all. Both deserve specifics.
 *
 * Every statement below describes what this software actually does — which
 * tables hold what, which third party receives what, what deleting an account
 * really removes. Where a thing is not done yet it says so rather than
 * promising it.
 */
const LEGAL_UPDATED = '28 July 2026';

/*
 * ⚠️ THIS MUST BECOME A REAL MAILBOX BEFORE META APP REVIEW.
 *
 * `.example` is the reserved domain for documentation — mail to it goes
 * nowhere, by design. Meta's reviewers send a message to the contact address on
 * the privacy policy, and a bounce is a rejection. It is one constant on
 * purpose: change it here and both the contact page and the privacy policy
 * change together.
 */
const CONTACT_EMAIL = 'hello@cyflowsocial.example';

function legal(kind) {
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  const intro = kind === 'privacy'
    ? 'This describes exactly what Cyflow Social stores, who else sees it, and how to get rid of it. It is written to be accurate about the software rather than broad enough to cover anything.'
    : 'These are the terms for using Cyflow Social, in plain language.';

  const body = kind === 'privacy' ? [
    ['Your account',
      'Your name, email address, a one-way hash of your password (never the password itself), and your timezone. '
      + 'Sessions are stored server-side so you can be signed out everywhere.'],
    ['Your business profile',
      'Whatever you enter or confirm about your business: its name, website, industry, description, services, contact details, '
      + 'brand colours, fonts, logo and social links. If you ask Cyflow to read your website, what it found is stored with the profile '
      + 'so you do not have to read it again. This is your business\'s own public information; nothing private is collected from your site.'],
    ['Connected social accounts',
      'When you connect a Facebook Page, an Instagram Professional account or a Threads profile, we store the account\'s id, its display name '
      + 'and username, which permissions you granted, and an ACCESS TOKEN THAT IS ENCRYPTED AT REST. The token is never shown back to you, '
      + 'never written to a log, and never included in an export. It is used for one thing: publishing the posts you approved, to the accounts you chose.'],
    ['What we do with Meta platform data',
      'We request the minimum to do the job: the list of Pages you manage, so you can pick one; permission to read basic engagement, so a failed '
      + 'post can be reported honestly; and permission to publish posts. We do not read your messages, your friends, your followers, your ads, or '
      + 'anyone else\'s content. We do not build profiles of you or anyone who sees your posts, and we never sell or share this data.'],
    ['The content you create',
      'The weekly plans, the post copy for each platform, the posters, and the record of what was published where and when. Posters are image files '
      + 'stored on the server and served only to you through a link that cannot be guessed.'],
    ['AI processing',
      'To write your posts and design your posters, the business details you confirmed and the topic for that day are sent to Anthropic\'s Claude. '
      + 'Your password, your access tokens and your contacts are NEVER sent. The generated post copy is not used to train anyone\'s model by us, '
      + 'and it is not shared with any other user.'],
    ['Logs',
      'We record that an action happened, whether it succeeded, and a category when it failed. Logs deliberately never contain access tokens, '
      + 'API keys, request headers, raw provider responses, or the text of your posts.'],
    ['Deleting your data',
      'Disconnecting an account removes its stored token immediately. Deleting your account removes your profile, your connected accounts and their '
      + 'tokens, your plans, your post copy and your posters. You can also export your data first. For Threads, Meta\'s own data-deletion callback is '
      + 'implemented and returns a confirmation code you can check.'],
    ['Who else can see it',
      'Nobody. One account\'s data is not readable by another, and this is enforced on every request rather than by hiding it in the interface.'],
  ] : [
    ['What the service does',
      'Cyflow Social reads your website, generates a week of social posts with AI, lets you review and change them, and publishes them to the '
      + 'accounts you connected, at the times you chose.'],
    ['Your content is yours',
      'You keep ownership of everything you create here. You grant us only what is needed to store it, generate from it, and publish it on your '
      + 'behalf to the accounts you selected.'],
    ['Your responsibility',
      'You are responsible for what is published under your accounts, and for having the right to publish it. AI-generated copy is a draft: '
      + 'nothing is published until you activate it, and you are expected to read it first. Do not use the service to publish anything unlawful, '
      + 'misleading, or in breach of the platforms\' own rules.'],
    ['Supported platforms',
      'Facebook Pages, Instagram Professional accounts and Threads profiles, subject to those platforms\' terms and to the permissions you granted. '
      + 'Those platforms can change or revoke access at any time, and when they do, publishing to them stops.'],
    ['Availability',
      'The service is provided as-is and is in active development. It may be unavailable, and a scheduled post may be delayed or fail. '
      + 'When something fails you are told what failed and why.'],
    ['Fair use',
      'Generation is limited per account so that one person cannot exhaust the service for everyone else. The limits are shown in the app before '
      + 'you reach them.'],
    ['Ending it',
      'You can disconnect any account or delete your own account at any time, from inside the app. Deleting removes your data as described in the '
      + 'privacy policy.'],
  ];

  return [
    hero(title, `Last updated ${LEGAL_UPDATED}.`, false),
    section(null, [
      el('div', { className: 'pub-callout', text: intro }),
      ...body.map(([t, b]) => el('div', { className: 'pub-legal-block' }, [
        el('h3', { className: 'pub-card-title', text: t }), el('p', { className: 'pub-card-body', text: b }),
      ])),
      el('p', { className: 'pub-fineprint', text: `Questions about your data, or a deletion request: ${CONTACT_EMAIL}. This page is accurate about how the software behaves; the legal wording has not been reviewed by a lawyer.` }),
    ]),
  ];
}

const VIEWS = {
  home, features, 'how-it-works': howItWorks, security, about, contact,
  privacy: () => legal('privacy'), terms: () => legal('terms'),
};

export async function render(root, ctx) {
  const view = ctx.view || 'home';
  const builder = VIEWS[view] || home;
  const active = view === 'home' ? '/' : `/${view}`;
  root.appendChild(el('div', { className: 'pub' }, [
    publicHeader(active, ctx.user),
    el('main', { className: 'pub-main' }, builder()),
    publicFooter(),
  ]));
}
