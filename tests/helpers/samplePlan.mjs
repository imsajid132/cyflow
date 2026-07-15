/**
 * A controlled 7-day Cyfrow Solutions plan.
 *
 * Fixed input for the render review and the quality gate. It is deliberately
 * hand-authored rather than generated: a review needs the same cards every run,
 * and the gate needs copy whose verdict is not hostage to a model's mood or to
 * an API key being present in CI.
 *
 * It is written to the standard the generator is now asked for, so it is also
 * the worked example of that standard: 7 topics, 6 formats, real post copy per
 * platform, no invented figures, no dashes.
 *
 * Everything here is derivable from the business profile (name, category, the
 * services it sells). Nothing states a price, a timescale, a client count, a
 * guarantee or a statistic, because the profile supplies none.
 */

export const PLAN = Object.freeze([
  {
    day: 1,
    format: 'quick_tip',
    templateKey: 'light-editorial',
    badge: 'Quick tip',
    serviceTag: 'Web performance',
    cta: 'Get in touch',
    headline: 'Compress images before you upload them',
    subheadline: 'Most slow pages are carrying photos far larger than they display.',
    facebook: [
      'A photo straight from a phone is often several thousand pixels wide. Dropped into a page that displays it at 800, the browser still downloads every one of those pixels and then throws most of them away.',
      'That is usually the single biggest thing making a site feel slow, and it is the easiest to fix. Resize the image to the width it will actually appear at, save it as WebP where you can, and you will often cut the file to a fraction of what it was with no visible difference.',
      'It is worth doing before you upload rather than after. Once a large file is in the library it tends to get reused on other pages, and the problem spreads quietly.',
      'If your pages feel heavy and you are not sure where to start looking, get in touch.',
    ].join('\n\n'),
    instagram: [
      'That hero photo might be four thousand pixels wide. Your layout shows it at eight hundred. The visitor downloads all four thousand anyway.',
      'Resizing an image to the size it is actually displayed at is the least glamorous performance fix there is, and usually the biggest. WebP will take it further again. The picture looks the same. The page stops crawling.',
      'Do it before the upload, not after. A big file sitting in the media library gets reused, and then it is slow on three pages instead of one. Not sure what is weighing your site down? Send us a message.',
    ].join('\n\n'),
    threads: [
      'Your phone shoots at several thousand pixels wide. Your page shows the photo at eight hundred. The browser downloads the lot regardless.',
      'Resize before uploading, not after. It is the dullest speed fix available and usually the one that makes the most difference.',
    ].join('\n\n'),
    hashtags: { facebook: ['#webdesign', '#websitespeed'], instagram: ['#webdesign', '#websitespeed', '#webdevelopment', '#ux'], threads: [] },
  },
  {
    day: 2,
    format: 'common_mistake',
    templateKey: 'editorial-insight',
    badge: 'Common mistake',
    serviceTag: 'Web development',
    cta: 'Talk to us',
    headline: 'Editing a live site is a gamble',
    subheadline: 'A staging copy catches the mistake before your customers do.',
    facebook: [
      'The plugin update looked routine. It ran on the live site at eleven in the morning, and the checkout stopped accepting payments until someone noticed.',
      'This is the most common way a working site breaks: a small change made directly on the thing customers are using. Nobody is being careless. It is just that the only place to test was production.',
      'A staging site is a copy of the real thing that nobody can see. Updates, new pages and design changes happen there first. If something breaks, it breaks in private, and you find out on your own schedule instead of from an angry phone call. If your only copy of your site is the live one, that is worth changing. Talk to us.',
    ].join('\n\n'),
    instagram: [
      'Eleven in the morning. A routine plugin update, run straight on the live site. Checkout stopped taking payments and nobody noticed for the best part of an hour.',
      'Almost every broken site starts here: a small change applied directly to the thing customers are using, because there was nowhere else to try it first. Nobody involved was being careless. They just had one copy of the site and it was the one earning money.',
      'Staging is only a private copy. You break things there, deliberately, on a Tuesday, when breaking them costs nothing at all. The live site then receives only changes that already worked somewhere else. One copy of your site is one too few. Message us.',
    ].join('\n\n'),
    threads: [
      'Most sites do not break because someone was careless. They break because the only place to test the change was the live site.',
      'A staging copy is not a luxury. It is the difference between finding a bug on a Tuesday afternoon and hearing about it from a customer.',
    ].join('\n\n'),
    hashtags: { facebook: ['#webdevelopment', '#smallbusiness'], instagram: ['#webdevelopment', '#wordpress', '#smallbusiness'], threads: [] },
  },
  {
    day: 3,
    format: 'checklist',
    templateKey: 'checklist-guide',
    badge: 'Checklist',
    serviceTag: 'Website launch',
    cta: 'Get in touch',
    headline: 'Check these before a site goes live',
    subheadline: 'The launch problems that get noticed are usually the boring ones.',
    bullets: [
      'Forms arrive in a real monitored inbox',
      'Every page has its own title and description',
      'Old URLs redirect to the new ones',
      'The certificate covers every subdomain',
      'Analytics is recording real page views',
    ],
    facebook: [
      'Launch day problems are rarely dramatic. The design is fine. What goes wrong is that the contact form quietly sends to an address nobody reads.',
      'The checks worth making are unglamorous. Submit every form and confirm a human receives it. Open a handful of pages and check each has its own title rather than inheriting the homepage. If the site replaced an older one, follow the old links and make sure they land somewhere sensible instead of a dead end.',
      'Then confirm the certificate covers the www version as well as the bare domain, and that analytics is actually recording. Both fail silently, which is what makes them worth checking by hand.',
      'Planning a launch and want a second pair of eyes? Get in touch.',
    ].join('\n\n'),
    instagram: [
      'The form worked perfectly in testing. It went live sending to an inbox nobody had opened since March, and the enquiries piled up where no one could see them.',
      'Launch failures are almost never about the design. They are about the plumbing: forms landing nowhere, every page sharing one title, old links dying quietly, a certificate that covers the bare domain but not the www version of it.',
      'All of that fails silently. None of it announces itself, and none of it shows up unless somebody sits down and checks each one by hand. That is an afternoon of work, and it buys you a calm first fortnight.',
      'Got a launch coming up? We can look over it with you.',
    ].join('\n\n'),
    threads: [
      'Launch problems are almost never the design. They are the contact form quietly sending to an inbox that nobody has opened since March.',
      'Submit every form yourself before you launch, and confirm a real person receives it. That single check catches more than all the others put together.',
    ].join('\n\n'),
    hashtags: { facebook: ['#websitelaunch', '#webdesign'], instagram: ['#websitelaunch', '#webdesign', '#smallbusiness'], threads: [] },
  },
  {
    day: 4,
    format: 'service_benefit',
    templateKey: 'service-authority',
    badge: 'Service',
    serviceTag: 'Website care',
    cta: 'Ask about care plans',
    headline: 'Maintenance costs less than recovery',
    subheadline: 'Updates, backups and monitoring, handled before anything breaks.',
    facebook: [
      'A site that has not been updated in a year is not sitting still. Its plugins are ageing, its certificate is heading for an expiry date, and its backups may or may not exist.',
      'None of that is visible from the outside, which is exactly the problem. The first sign is usually the site going down, or worse, staying up while quietly serving something it should not be.',
      'Our care work is deliberately boring. Updates get applied on a staging copy first and only then on the live site. Backups run and get tested by actually restoring one, because a backup nobody has restored is a hope rather than a plan. Uptime is watched so we hear about an outage before you do.',
      'If nobody is currently looking after your site, ask us about care plans.',
    ].join('\n\n'),
    instagram: [
      'Nothing has changed on the site in a year. That is not stability, it is drift: ageing plugins, a certificate quietly heading for its expiry date, and backups nobody has ever tried to restore.',
      'You cannot see any of that from the front page, which is exactly the problem. The first symptom is usually the outage itself, and by then you are fixing it in a hurry.',
      'Our care work is meant to be dull. Updates go on a staging copy first and only then on the live site. Backups run, and then we actually restore one to prove it works. Uptime is watched so the outage reaches us before it reaches you.',
      'Nobody looking after your site right now? Ask us about care plans.',
    ].join('\n\n'),
    threads: [
      'A backup that nobody has ever restored is not really a backup. It is a hope with a filename attached to it.',
      'Test the restore. That is the whole job, and it is the one step everyone skips. Everything else about maintenance is straightforward by comparison.',
    ].join('\n\n'),
    hashtags: { facebook: ['#websitecare', '#webdevelopment'], instagram: ['#websitecare', '#webdevelopment', '#smallbusiness'], threads: [] },
  },
  {
    day: 5,
    format: 'comparison',
    templateKey: 'comparison-cards',
    badge: 'Comparison',
    serviceTag: 'Web development',
    cta: 'Talk it through',
    headline: 'Template or custom build',
    subheadline: 'Both are right sometimes. The question is what happens in year two.',
    comparison: {
      leftTitle: 'Template',
      rightTitle: 'Custom build',
      leftItems: ['Live in days', 'Layout set by the theme', 'Carries features you never use'],
      rightItems: ['Built around your process', 'Changes as the business does', 'Only the code you need'],
    },
    facebook: [
      'A template is not the cheap option and a custom build is not the serious one. They answer different questions.',
      'A template gets you live quickly and cheaply, and for a business whose site is essentially a brochure that is often the correct answer. The trade is that you work the way the theme works. It also arrives carrying features you will never use, and each of those is code that still has to load and still has to be kept updated.',
      'A custom build earns its cost when the site has to do something specific: a booking flow that matches how you actually take bookings, a product structure the theme has no concept of. You get only what you need, and it changes as you do.',
      'The useful question is not which is better. It is what your site has to do in two years. Happy to talk it through.',
    ].join('\n\n'),
    instagram: [
      'Everyone asks which one is better. That is the wrong question, and it is why the answer never settles anything.',
      'Buying a theme gets you live quickly, and for a site that is essentially a brochure that is often exactly right. What you accept is working the way the theme works, plus a pile of features you will never touch that still load on every page and still need updating.',
      'Building from scratch earns its cost the moment the site has to match how you actually operate: a booking flow shaped like your bookings, a product structure the theme has no concept of. Only the code you need, and it moves as you do.',
      'Ask what the site must do in year two. Want to talk it through?',
    ].join('\n\n'),
    threads: [
      'Year two is when you find out which one you picked.',
      'Buying a theme asks how fast this can be live. Building from scratch asks what happens when the business stops fitting the theme, and whether you can do anything about it when it does.',
    ].join('\n\n'),
    hashtags: { facebook: ['#webdesign', '#webdevelopment'], instagram: ['#webdesign', '#webdevelopment', '#smallbusiness'], threads: [] },
  },
  {
    day: 6,
    format: 'process',
    templateKey: 'checklist-guide',
    badge: 'Process',
    serviceTag: 'Web development',
    cta: 'Start a conversation',
    headline: 'How a website project actually runs',
    subheadline: 'No stage where you wait a month and hope.',
    bullets: [
      'We map what the site has to do',
      'You see the layout before we build',
      'Building happens on a private URL',
      'You review it on your own devices',
      'We launch and watch the first week',
    ],
    facebook: [
      'The worst part of most web projects is the silence. You approve something in week one, then hear nothing until a finished site appears and it is too late to say it is not quite right.',
      'It does not have to run that way. We start by writing down what the site actually has to do, because "a new website" is not a brief and the disagreements surface here, on paper, where they are cheap.',
      'Then you see the layout before anything is built. Building happens on a private URL you can open any time, so there is no reveal, just a thing that gradually becomes your site. You review it on your own phone rather than in a screenshot.',
      'After launch we watch the first week, because that is when real traffic finds the things testing did not. If that sounds like a better way to do it, start a conversation.',
    ].join('\n\n'),
    instagram: [
      'Approve something in week one. See it finished in week eight. Discover in week nine that it is not what you meant.',
      'It starts with writing down what the site has to do, because "a new website" is not a brief. Every disagreement worth having happens there, on paper, before anyone has built anything and while changing your mind is free. Then you see the layout before the build starts.',
      'The build itself lives on a private URL you can open whenever you like, checked on your own phone rather than in a screenshot. We watch the first week after launch, because real traffic finds what testing missed. Sound better? Start a conversation.',
    ].join('\n\n'),
    threads: [
      'Give the client a URL they can open any day of the build, and the big reveal simply stops existing.',
      'There is nothing left to reveal. They watched it happen, they said so at the time, and nobody spent week nine unpicking week two.',
    ].join('\n\n'),
    hashtags: { facebook: ['#webdevelopment', '#process'], instagram: ['#webdevelopment', '#webdesign', '#smallbusiness'], threads: [] },
  },
  {
    day: 7,
    format: 'educational_insight',
    templateKey: 'editorial-insight',
    badge: 'Insight',
    serviceTag: 'Hosting and domains',
    cta: 'Ask us',
    headline: 'Your domain and hosting are separate things',
    subheadline: 'Knowing which is which turns a panic into a five minute fix.',
    facebook: [
      'When a site goes down, the first question is almost always aimed at the wrong company. People ring their hosting provider about a domain problem, or their registrar about a server problem, and lose an afternoon to it.',
      'The two are genuinely separate. Your domain is the name, rented from a registrar. Your hosting is the machine the files sit on, rented from someone else. A record called DNS connects the name to the machine. They are often bought from the same company, which is exactly why they get confused.',
      'The practical use of knowing this: if the site is down but email still works, that points at hosting. If nothing resolves at all, including email, that points at the domain or its DNS. Two minutes of thinking sends you to the right support queue.',
      'Not sure who holds what for your business? Ask us. It is usually a quick answer.',
    ].join('\n\n'),
    instagram: [
      'Site is down. Most people ring the wrong company first and lose an afternoon to it.',
      'Your domain is the name, rented from a registrar. Your hosting is the machine your files live on, rented from someone else. DNS is the record that points the name at the machine. They are often sold by the same company, which is why nobody separates them.',
      'Useful in practice: site down but email working points at hosting. Nothing resolving at all, email included, points at the domain or its DNS. That is two minutes of thinking and the right support queue. Not sure who holds what for you? Ask us.',
    ].join('\n\n'),
    threads: [
      'Site down? If your email still works, it is probably hosting. If email is dead too, look at the domain or its DNS.',
      'Your domain is the name. Your hosting is the machine. They are usually bought from the same company, which is the only reason anyone confuses them.',
    ].join('\n\n'),
    hashtags: { facebook: ['#hosting', '#smallbusiness'], instagram: ['#hosting', '#webdevelopment', '#smallbusiness'], threads: [] },
  },
]);

export default PLAN;
