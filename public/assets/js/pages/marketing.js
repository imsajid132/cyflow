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
        el('a', { className: 'pub-mail', text: 'hello@cyflowsocial.example', attrs: { href: 'mailto:hello@cyflowsocial.example' } }),
      ]),
      el('p', { className: 'pub-fineprint', text: 'An in-app contact form is not available yet, so this page does not pretend to send one. Email reaches us directly.' }),
    ]),
  ];
}

function legal(kind) {
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  const intro = kind === 'privacy'
    ? 'This is a plain-language draft describing how Cyflow Social handles your data. It is not a substitute for legal advice and must be reviewed by a lawyer before launch.'
    : 'This is a plain-language draft of the terms for using Cyflow Social. It is not a substitute for legal advice and must be reviewed by a lawyer before launch.';
  const body = kind === 'privacy' ? [
    ['What we store', 'Your account details, business and brand profile, the social accounts you connect, the content you create, your media, and activity history.'],
    ['Credentials', 'Your OpenAI and HCTI keys and provider tokens are encrypted at rest. We never display them back to you or write them to logs.'],
    ['Third parties', 'When you ask for AI help, your content is sent to OpenAI using your own key. When you generate an image, it is sent to your HCTI account. Publishing sends your content to the Meta platform for the account you selected.'],
    ['Your choices', 'You can disconnect accounts, remove your keys, and (as this capability lands) export or delete your data.'],
  ] : [
    ['Using the service', 'You are responsible for the content you create and publish, and for having the right to publish it to the accounts you connect.'],
    ['Supported platforms', 'The service publishes to Facebook Pages, Instagram Professional and Threads only, subject to those platforms’ own terms and your approved permissions.'],
    ['Availability', 'The service is provided as-is while in active development. Publishing availability depends on your connected accounts and provider permissions.'],
    ['Your content', 'You keep ownership of your content. You grant us only what is needed to store, process and publish it on your behalf.'],
  ];
  return [
    hero(title, 'Draft — pending legal review.', false),
    section(null, [
      el('div', { className: 'pub-callout', text: intro }),
      ...body.map(([t, b]) => el('div', { className: 'pub-legal-block' }, [
        el('h3', { className: 'pub-card-title', text: t }), el('p', { className: 'pub-card-body', text: b }),
      ])),
      el('p', { className: 'pub-fineprint', text: 'No company legal name, address or lawyer approval is claimed on this page.' }),
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
