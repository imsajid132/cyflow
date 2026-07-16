/**
 * A controlled seven-day Cyfrow Solutions plan — Phase 4.8, Balanced rhythm.
 *
 * Fixed input for the render review and the quality gates. Hand-authored, not
 * generated: a review needs the same cards every run, and the gate needs copy
 * whose verdict does not depend on a model's mood or an API key in CI.
 *
 * It is also the worked example of the current standard, so it must pass it:
 * the weekday pillars are the Balanced rhythm, the platform bands are the 4.8
 * ranges (Facebook 130-220, Instagram 120-200, Threads 45-100), and nothing
 * states a price, a timescale, a client count, a guarantee, a rating or a
 * statistic, because the Cyfrow profile supplies none. No em or en dashes.
 *
 * Cyfrow Solutions is an SEO agency. Its services and palette are the brief's.
 */

export const PLAN = Object.freeze([
  {
    day: 1,
    weekday: 1, // Monday
    pillar: 'educational_insight',
    format: 'educational_insight',
    templateKey: 'editorial-insight',
    visualFamily: 'editorial_insight',
    badge: 'Insight',
    serviceTag: 'Keyword Research',
    cta: 'Ask us',
    headline: 'Keywords are not the same as intent',
    subheadline: 'The word someone types and the thing they want are two different things.',
    facebook: [
      'Two people can search the exact same phrase and want completely different things. Someone typing "roof repair" might be looking for a contractor to call today, or they might be a homeowner trying to work out whether a damp patch is serious enough to worry about.',
      'That gap is the whole game in keyword work. A page built for the first person leads with a way to get in touch. A page built for the second one explains the warning signs first and earns the trust before it asks for anything. Aim the same page at both and it serves neither well.',
      'So before chasing a keyword because it has traffic, it is worth asking what the person behind it is actually trying to do. The search volume tells you how many people ask. Only the intent tells you what to write, and if you are unsure what your best keywords are really asking for, ask us and we will walk through it with you.',
    ].join('\n\n'),
    instagram: [
      'Two people type "roof repair" and want opposite things. One wants a contractor to call now. The other wants to know if a damp patch is even a problem yet.',
      'That gap is the whole game. A page built for the caller opens with a way to get in touch. A page for the worried homeowner explains the warning signs first and earns trust before it asks for anything. One page aimed at both serves neither.',
      'Search volume tells you how many people ask a question. It never tells you what they want. Before you chase a keyword because the traffic looks good, work out what the person behind it is actually trying to do, then write for that.',
      'Not sure what your keywords are really asking for? Send us a message.',
    ].join('\n\n'),
    threads: [
      'Two people search the same phrase and want opposite things. One is ready to buy. One is just checking whether they have a problem at all.',
      'Search volume tells you how many people ask. Only intent tells you what to write. Chase the volume without the intent and you build a page that serves nobody.',
    ].join('\n\n'),
    hashtags: { facebook: ['#seo', '#keywordresearch'], instagram: ['#seo', '#keywordresearch', '#smallbusiness', '#digitalmarketing'], threads: [] },
  },
  {
    day: 2,
    weekday: 2, // Tuesday
    pillar: 'service_promotion',
    format: 'service_benefit',
    templateKey: 'service-authority',
    visualFamily: 'service_authority',
    badge: 'Service',
    serviceTag: 'On-Page SEO',
    cta: 'Talk to us',
    headline: 'On-page SEO is quieter than it sounds',
    subheadline: 'Most of the work happens where visitors never look.',
    facebook: [
      'When people picture SEO they tend to picture keywords sprinkled through the text. The part that actually moves a page is quieter than that, and most of it happens where a visitor never looks.',
      'On-page work is making sure each page has one clear job and says so in its title. It is writing the description that decides whether anyone clicks your result instead of the one above it. It is giving headings a real structure so a search engine, and a person skimming on a phone, can both follow the page. It is making images describe themselves so they are not dead weight.',
      'None of that is glamorous and none of it shows up in a screenshot. It is the difference between a page that technically mentions your service and a page that is genuinely built to be found for it.',
      'If your pages read well to people but never seem to surface in search, on-page work is usually where the answer is. Talk to us and we will take a look.',
    ].join('\n\n'),
    instagram: [
      'The title of a page is a line most visitors never consciously read. It is also one of the biggest decisions on the whole page, because it is what a searcher sees before they choose whether to click you or the result sitting just above you.',
      'That is the kind of thing on-page work is really about. One clear job per page. A description worth clicking. Headings with a real structure that a phone-skimmer and a search engine can both follow. Images that describe themselves instead of sitting there as dead weight. None of it shows up in a screenshot, and all of it decides whether a page gets found.',
      'Pages that read well to people but never surface in search are usually pages where this quiet layer was skipped. Message us and we will take a look.',
    ].join('\n\n'),
    threads: [
      'SEO is not keywords sprinkled through the text. The part that moves a page is quieter, and it lives where visitors never look.',
      'One clear job per page. A title that says so. A description worth clicking. Headings with real structure. That is the unglamorous work that actually gets a page found.',
    ].join('\n\n'),
    hashtags: { facebook: ['#onpageseo', '#seo'], instagram: ['#onpageseo', '#seo', '#smallbusiness'], threads: [] },
  },
  {
    day: 3,
    weekday: 3, // Wednesday
    pillar: 'trust_authority',
    format: 'faq_answer',
    templateKey: 'faq-editorial',
    visualFamily: 'faq_editorial',
    badge: 'FAQ',
    serviceTag: 'SEO Audit',
    cta: 'Ask us',
    headline: 'How do you decide what to fix first?',
    subheadline: 'An honest audit ranks the work by impact, not by how alarming it looks.',
    answerSummary: 'We start with what is blocking pages from being found or read at all, then what confuses search engines, then the smaller refinements. Alarming-looking issues are not always the ones that matter, so we rank by impact rather than by how red the report looks.',
    bullets: ['First: what blocks a page entirely', 'Then: what confuses search engines', 'Last: the smaller refinements'],
    facebook: [
      'It is a fair question to ask any SEO before you hand over a site, because the honest answer tells you how someone thinks. A report that lists forty problems in red is easy to produce and hard to act on.',
      'The order that matters starts with anything stopping a page from being found or read at all: a page search engines cannot reach, a broken redirect, a setting quietly telling Google to ignore a section. Those come first because nothing else you do counts until they are fixed. Then come the things that confuse rather than block: unclear titles, thin pages, a structure that sends mixed signals. The small refinements come last.',
      'What we try never to do is lead with the most alarming-looking item just because it makes the audit feel urgent. Alarming and important are not the same thing.',
      'If you want a second opinion on a site, ask us and we will tell you plainly what we would touch first.',
    ].join('\n\n'),
    instagram: [
      'Forty problems, all in red, ranked by nothing. That is what most audit reports look like, and it is why most of them get opened once and never acted on.',
      'The ranking is the whole value. A page search engines cannot reach, a broken redirect, a setting quietly telling Google to skip a section: those sit at the top, because until they are fixed nothing else you do counts for anything. Below them go the things that confuse rather than block, like unclear titles and thin pages. The polish goes last, where polish belongs.',
      'The temptation is to lead with whatever looks scariest, because it makes the audit feel worth paying for. We try not to. Alarming and important are different things, and a good report knows the difference.',
      'Want a plain second opinion on your site? Ask us.',
    ].join('\n\n'),
    threads: [
      'Fair question to ask any SEO: what would you fix first? A report with forty red problems is easy to produce and useless to act on.',
      'Fix what blocks a page from being found at all before anything else. Then what confuses search engines. Refinements last. Scary-looking and important are not the same thing.',
    ].join('\n\n'),
    hashtags: { facebook: ['#seoaudit', '#seo'], instagram: ['#seoaudit', '#seo', '#smallbusiness'], threads: [] },
  },
  {
    day: 4,
    weekday: 4, // Thursday
    pillar: 'problem_solution',
    format: 'comparison',
    templateKey: 'comparison-cards',
    visualFamily: 'comparison_cards',
    badge: 'Comparison',
    serviceTag: 'Technical SEO',
    cta: 'Talk it through',
    headline: 'Chasing rankings or fixing the plumbing',
    subheadline: 'One feels productive. The other is usually what was actually wrong.',
    comparison: {
      leftTitle: 'Chasing rankings',
      rightTitle: 'Fixing the plumbing',
      leftItems: ['More keywords, more pages', 'Guessing at what Google wants', 'Nothing moves and nobody knows why'],
      rightItems: ['Pages that can be crawled', 'A structure search engines can read', 'A base the content can build on'],
    },
    facebook: [
      'When a site is not ranking, the instinct is to make more: more keywords, more pages, more blog posts aimed at whatever seems to be working for someone else. It feels productive. It is often the wrong move.',
      'A lot of the time the real problem is underneath. Pages a search engine cannot properly reach. A structure that sends it in circles. Duplicate versions of the same page competing with each other. A site can publish excellent content for months and see none of it land, because the plumbing below it is leaking the whole time.',
      'Technical work is not exciting and it does not produce something to show a client on day one. But fixing what a search engine actually struggles with is usually what unlocks everything the content was already trying to do.',
      'If you have been publishing hard and seeing nothing back, it is worth checking the foundation first. Happy to talk it through.',
    ].join('\n\n'),
    instagram: [
      'Six months of blog posts. Nothing moved. So the plan for the next six months is more blog posts.',
      'This is the loop a lot of sites get stuck in, and the way out is usually underneath the content rather than in it. Pages a search engine cannot properly reach. A structure that sends it round in circles. Two versions of the same page quietly competing with each other. Every one of those will swallow good work without leaving a trace of why.',
      'The fix is dull. It produces nothing to show off on day one, and it never feels like progress while you are doing it. It is also, more often than not, the thing that finally lets the content you already wrote do its job.',
      'Publishing hard and seeing nothing back? Check the foundation first. Want to talk it through?',
    ].join('\n\n'),
    threads: [
      'Site not ranking, so the plan is to publish more? That feels productive, and it is usually the wrong move.',
      'Often the problem sits underneath the content: pages a search engine cannot reach, a structure that loops back on itself, two versions of one page quietly fighting each other. Good writing lands nowhere while the plumbing leaks.',
    ].join('\n\n'),
    hashtags: { facebook: ['#technicalseo', '#seo'], instagram: ['#technicalseo', '#seo', '#webdevelopment'], threads: [] },
  },
  {
    day: 5,
    weekday: 5, // Friday
    pillar: 'actionable_tips',
    format: 'checklist',
    templateKey: 'checklist-guide',
    visualFamily: 'checklist_guide',
    badge: 'Checklist',
    serviceTag: 'Local SEO',
    cta: 'Get in touch',
    headline: 'Check these for local search',
    subheadline: 'The basics that quietly decide whether you show up nearby.',
    bullets: [
      'Your business name is identical everywhere',
      'The same address and phone on every listing',
      'Your Google profile categories are right',
      'Real photos, not stock, on the profile',
      'You reply to reviews, good and bad',
    ],
    facebook: [
      'Local search rewards consistency more than cleverness, and most of the wins are things you can check yourself in an afternoon. None of them are secrets. They are just the sort of details that drift over the years as listings get made and forgotten.',
      'Start with your name, address and phone, and make them identical everywhere they appear. Not almost identical. A suite number on one listing and not another is enough to muddy things. Then look at your Google Business Profile: the categories should match what you actually do, the photos should be real ones of your work rather than stock, and the information should be current.',
      'Then reviews. Replying to them, the awkward ones included, is a signal that a real business is paying attention, and it reads that way to people too.',
      'If your listings have drifted over the years and you want a hand tidying them, get in touch.',
    ].join('\n\n'),
    instagram: [
      'A suite number on one listing and missing from the next. That is the kind of tiny inconsistency that quietly muddies where you show up locally.',
      'None of this is clever work. Your name, address and phone need to match everywhere they appear, and almost matching does not count. Your Google Business Profile needs categories that describe what you actually do, photos that are genuinely yours rather than stock, and details that are still true. Most of these listings were made once, years ago, and never looked at again.',
      'Reviews are the last piece, and replying to them matters more than people expect. Answering the awkward ones is the clearest signal there is that a real person is paying attention.',
      'Listings drifted over the years? We can help you tidy them. Get in touch.',
    ].join('\n\n'),
    threads: [
      'Local search rewards consistency over cleverness. Most of the wins are a free afternoon of checking.',
      'Same name, address and phone everywhere, down to the suite number. A Google profile with the right categories and real photos. Replies to reviews, awkward ones included. That is most of it.',
    ].join('\n\n'),
    hashtags: { facebook: ['#localseo', '#smallbusiness'], instagram: ['#localseo', '#smallbusiness', '#seo'], threads: [] },
  },
  {
    day: 6,
    weekday: 6, // Saturday
    pillar: 'engagement_local',
    format: 'local_relevance',
    templateKey: 'local-insight',
    visualFamily: 'local_authority',
    badge: 'Local',
    serviceTag: 'Local SEO',
    cta: 'Ask us',
    headline: 'Being nearby is a ranking factor now',
    subheadline: 'For a lot of searches, the map comes before the list.',
    localLabel: 'Local search',
    facebook: [
      'A decade ago, ranking for a service meant competing with everyone in the country who offered it. For a growing share of searches, that is no longer how it works. When someone looks for a service they can walk or drive to, the results reshape around where they are standing.',
      'That changes what matters. A national competitor with a huge site does not automatically win a local search, because proximity and local signals are part of the calculation now. A smaller business that is genuinely present in its area, with accurate listings and reviews from real local customers, can hold its own on the searches that actually bring work through the door.',
      'It also means the map results and the ordinary blue links are two different games. Turning up in one does not mean you turn up in the other, and for a local business the map is often the one that pays.',
      'If you serve a specific area and are not sure how you show up there, ask us and we will check.',
    ].join('\n\n'),
    instagram: [
      'The map at the top of the results and the blue links underneath it are two separate competitions. Winning one tells you almost nothing about the other.',
      'For a local business the map is usually the one that pays, and the good news is that it is not decided by who has the biggest website. Where the searcher is standing is part of the calculation now, alongside how accurate your listings are and whether real customers nearby have reviewed you. A national competitor cannot buy its way past geography.',
      'That is a genuine shift. It means being properly present in your own area is worth more than trying to out-publish a company that will never send anyone to your street.',
      'Serve a specific area and unsure how you show up there? Ask us.',
    ].join('\n\n'),
    threads: [
      'Ranking used to mean competing with the whole country. For local searches, it does not any more. The results reshape around where the searcher is standing.',
      'A huge national site does not automatically win a local search. Proximity counts now. The map and the blue links are two different games, and the map is often the one that pays.',
    ].join('\n\n'),
    hashtags: { facebook: ['#localseo', '#smallbusiness'], instagram: ['#localseo', '#smallbusiness', '#marketing'], threads: [] },
  },
  {
    day: 7,
    weekday: 7, // Sunday
    pillar: 'soft_promo_recap',
    format: 'soft_promo',
    templateKey: 'light-editorial',
    // The brief's "Minimal Editorial" for a Sunday: a quiet recap does not want
    // a conversion panel. The family and the layout must always agree.
    visualFamily: 'light_editorial',
    badge: 'This week',
    serviceTag: 'Content Writing',
    cta: 'Start a conversation',
    headline: 'Good SEO is mostly patient work',
    subheadline: 'A quiet recap of a week that had no shortcuts in it.',
    facebook: [
      'If there is a thread running through this week, it is that almost none of the useful work in search is dramatic. It is understanding what a searcher actually wants, writing the page that answers it, fixing the plumbing underneath, and keeping the local details tidy.',
      'That is a harder thing to sell than a secret, because there is no single trick to point at. But it is also why it works and keeps working. A site built on real answers and a sound foundation does not collapse the next time the rules shift, the way a site built on shortcuts tends to.',
      'None of it needs to happen all at once either. Pick the one thing that is most clearly holding your site back and start there. Progress in search is cumulative, which is the good news: the work you do this month is still working for you next year.',
      'If you would like a hand deciding where to start, start a conversation with us this week.',
    ].join('\n\n'),
    instagram: [
      'No secret got mentioned this week. That was not an oversight.',
      'Everything worth doing in search turned out to be ordinary: work out what a searcher actually wants, write the page that answers it, fix the plumbing underneath it, keep the local details honest. There is no trick in that list, which makes it a poor thing to advertise and a reliable thing to own. Sites built this way tend to survive the next time the rules move, because they were never balanced on a loophole.',
      'You also do not have to do all of it. Pick whichever piece is most obviously holding you back and start there. Search work compounds, so this month keeps paying next year.',
      'Want a hand deciding where to start? Start a conversation with us.',
    ].join('\n\n'),
    threads: [
      'The theme of the week: almost none of the useful work in search is dramatic. Answer the searcher, fix the plumbing, keep the local details tidy.',
      'Harder to sell than a secret, and the reason it keeps working. Pick the one thing holding your site back and start there. Search progress is cumulative.',
    ].join('\n\n'),
    hashtags: { facebook: ['#seo', '#contentmarketing'], instagram: ['#seo', '#contentmarketing', '#smallbusiness'], threads: [] },
  },
]);

export default PLAN;
