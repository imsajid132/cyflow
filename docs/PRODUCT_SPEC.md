# Cyflow — the product, as the owner defined it

This is the FINAL definition of what the application is. It was given by the
owner on 2026-07-25 and supersedes any earlier shape. Where an existing feature
does not serve this flow, this document wins.

The whole product is one path: **a website in, a week of posts out, then it keeps
going by itself.**

---

## 1. Analyze

One screen. The user enters their website address.

The app reads the site and shows **everything it found, in full and correct**:

- logo (the actual mark, shown)
- fonts (heading and body, named)
- colours (every colour found, with the three roles chosen)
- business name, industry, description, services
- location, contact details, social links

Nothing is hidden behind "advanced". If the app found it, the user sees it. If
the app got something wrong, the user can correct it.

Below the details: one button, **Next → generate posts**.

## 2. Generate a week

The next screen has **no tone selector, no topic box, no style picker**. The user
does not brief the AI. **Claude decides everything** from the brand it just read.

One button: **Generate posts**. It produces **a full week of posts**.

## 3. Review

The week is shown for checking. For every post:

- the poster, with a **Regenerate poster** button underneath it
- the post copy, with a **Regenerate caption** button

Each regenerate affects only that one thing, and the result is never a repeat.

## 4. Choose accounts

Below the week: the user's **connected accounts** — nothing else, no other
options. Each account is selectable.

## 5. Activate

When the user activates for the chosen accounts:

- **one post goes out immediately** to those accounts
- the rest are scheduled

Then, for the ongoing schedule, the user picks:

- the **timezone** — every timezone in the world is offered
- the **time of day** the daily post goes out

From then on it runs by itself: one post a day, and the app keeps producing more
so it never runs out. It does not matter whether the user ever opens the app.

## 6. Never repeat

**Every post is unique, every time.** Not almost-unique, not usually-unique. A
duplicate is a defect, including across weeks and across regenerations.

## 7. How it must feel

- **Professional.** Built properly, not assembled.
- **Animated.** Real motion, used with purpose.
- **Lazy-loaded.** Nothing heavy blocks the first paint.
- **The dark studio look** the app already carries.

---

## The one thing that needs the owner's explicit say-so

Step 5 sends **a real post to real Facebook / Instagram / Threads accounts**.
Publishing has never run live here: `ENABLE_LIVE_PROVIDER_PUBLISHING=false` is
the current, deliberate state, and every test to date has used a fake provider.

Turning it on is not reversible in the way code is — a published post is public.
So it gets switched on **once, deliberately, with the owner watching**, on one
account, after the rest of the flow is proven. Never as a side effect of shipping
something else.

---

## Build order

1. **Analyze, in full** — every detail the reader finds, shown and correctable.
2. **Generate a week** — no options, Claude decides, a whole week at once.
3. **Review** — per-poster and per-caption regeneration.
4. **Accounts** — the user's connected accounts, selectable.
5. **Schedule** — every world timezone, a daily time.
6. **Activate** — the first post live (see the note above), the rest scheduled,
   the buffer refilling itself forever.
7. **Uniqueness** — proven across weeks and regenerations, not assumed.
8. **Motion and loading** — animation and lazy-loading through the whole flow.

Each step is finished and looked at in a browser before the next one starts.
