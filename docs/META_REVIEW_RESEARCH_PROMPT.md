# A prompt to hand to ChatGPT (or any assistant with live web access)

Meta's verification and App Review requirements change, and they differ by
country. That is live external policy, not something to answer from memory —
so this is written to be pasted into an assistant that can actually check
Meta's current documentation.

Copy everything between the lines.

---

I need step-by-step help getting a Meta (Facebook) app through App Review so
that **any member of the public** can connect their own Facebook Page,
Instagram Professional account and Threads profile to my product by pressing a
normal "Allow" button. Right now my app is Unpublished, so only people I add as
testers can connect, and everyone else gets "App not active".

**Please search the web for Meta's CURRENT requirements before answering. Do
not answer from memory — these rules change and I will act on what you say.**

## About me

- I am in Pakistan.
- I do NOT have a registered business or company. I am one person.
- I own the domain and the product is live and working on it.
- I am not a developer by trade, so give me exact clicks and exact wording,
  not concepts.

## About the product

It is a live SaaS called Cyflow Social. What it does, end to end:

1. The user enters their business website. The app reads it and shows what it
   found: logo, colours, fonts, services, contact details, images. All editable.
2. One button generates a full week of seven social posts. An AI writes the
   post copy for each platform and designs a 1080x1080 poster for each day,
   using a photograph from the user's own website.
3. The user reviews the week and can regenerate any single poster or any single
   set of captions.
4. The user picks which of their connected accounts to post to, a timezone and a
   time of day.
5. One button activates it: the first post goes out immediately, the rest follow
   one per day, automatically, without the app being open.

It has already published a real post to a real Facebook Page successfully.

## The permissions I need approved

- `pages_show_list` — so the user can choose WHICH of their own Pages to post to
- `pages_read_engagement` — so a failed publish can be reported with the real reason
- `pages_manage_posts` — to publish the posts the user approved
- `instagram_business_basic` — to identify the Instagram Professional account
- `instagram_business_content_publish` — to publish to it
- `threads_basic` — to identify the Threads profile
- `threads_content_publish` — to publish to it

I do not read messages, followers, ads or anyone else's content, and I do not
sell or share data.

## What I already have

- A live HTTPS site
- A written Privacy Policy page and a Terms of Service page, both describing
  exactly what data is stored, what is sent to third parties, and how deletion
  works
- A working data-deletion callback for Threads that returns a confirmation code
- A working deauthorize callback for Threads
- The product genuinely working, so I can record a real screencast

## What I need from you

Answer these in order, with sources and dates, and tell me clearly when
something is impossible rather than giving me a workaround that will fail:

1. **Can I complete Meta Business Verification as an individual in Pakistan with
   no registered company?** Exactly what documents does Meta accept today for my
   country? If a registered business is genuinely required, say so plainly and
   tell me the cheapest legitimate way to become one in Pakistan (for example
   FBR / NTN sole proprietor registration) — what it costs, how long it takes,
   and what I would end up with.

2. **Is "Tech Provider" mandatory for my case,** or is there a path that does not
   need it? What exactly does becoming one require?

3. **The exact click path,** in today's Meta dashboard, from where I am now to a
   submitted App Review. Name the actual menus and buttons. My dashboard
   currently shows the use cases "Manage everything on your Page", "Manage
   messaging & content on Instagram", and "Access the Threads API".

4. **What exactly to write** in the justification box for each permission above.
   Give me text I can paste, written for a reviewer, specific to what my product
   does.

5. **The screencast requirements** — length, what must be visible, what causes a
   rejection. Give me a shot list.

6. **The most common rejection reasons** for these specific permissions, and how
   to avoid each one.

7. **A realistic timeline** from today to "any user can press Allow".

Ask me clarifying questions if you need them. Do not guess at Meta's
requirements — check.

---

## When you get answers back

Bring them here. Anything that turns out to be a change in the product — a
callback URL, a page, wording, a deletion flow — is code, and code is this
side. What ChatGPT is better at is telling you what Meta wants today.
