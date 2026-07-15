---
name: cyflow-social-post-writer
description: Write, edit, review or regenerate Cyflow social post copy for Facebook Pages, Instagram Professional and Threads. Use whenever planner or manual post text is being generated or judged — openaiContentService prompts, contentStyleGuard rules, planner briefs, or reviewing a generated weekly plan. Enforces real multi-paragraph posts, platform-specific voice, banned phrasing, no em dashes, and genuine duplicate prevention.
---

# Cyflow social post writer

You are writing for a real small business whose name is on this. A post that
reads as machine-written costs them more credibility than posting nothing.

## Terminology

This is **social post copy**, not a "caption".

Internal field names (`caption`, `platformCaptions`, `captionOverride`) stay as
they are for compatibility — do not rename database columns or API fields for
this. But user-facing wording should say:

- **Post copy**
- **Facebook post**
- **Instagram post**
- **Threads post**

"Caption" implies one line under a picture. That framing is what produced the
one-sentence adverts this replaces.

## Post structure

**Facebook and Instagram** — a real post:

1. A strong opening paragraph that earns the next line.
2. A useful explanation, observation, tip, or practical detail.
3. A second short paragraph that develops the idea rather than repeating it.
4. A natural close or CTA, where one belongs.
5. Hashtags separately at the end, never woven into the sentences.

Length:

- normally **100–180 words**
- **2–4 short paragraphs**
- paragraphs normally **1–3 sentences**
- never one giant block
- never a single promotional sentence
- shorter is allowed only when the format genuinely requires it, and you should
  be able to say why

**Threads:**

- normally **40–100 words**
- one clear idea
- 1–3 short paragraphs
- concise but still useful
- **not a trimmed Instagram post** — write it for Threads
- no bloated marketing language

## Writing standard

Every post must:

- sound like a capable human wrote it
- be specific to *this* business
- focus on one service, audience problem, question, process or insight
- carry information a reader can use
- vary its sentence length naturally
- use short readable paragraphs

Every post must avoid:

- fake urgency
- invented proof, statistics, prices, timescales or client counts
- unsupported guarantees
- repeating the business name unnecessarily (once, or not at all)
- keyword stuffing
- generic motivational filler

**If a fact is not in the brief, it does not go in the post.** Being unspecific
beats being wrong. When a format wants a number the business never supplied,
return an empty value and let the design fall back — never invent one to fill a
template.

## Banned characters

Never output an em dash (`—`) or an en dash (`–`).

Replace with:

- a period
- a comma
- a colon
- parentheses
- a normal hyphen, only where grammatically required ("on-page", "geo-targeting")

This is enforced after generation by `contentStyleGuard`, which **repairs** dash
punctuation rather than discarding the post — the sentence around a dash is
usually fine. Do not rely on the repair. Write without them.

## Banned phrases

Never use, and never use a close variant of:

- In today's digital world
- Unlock your potential
- Elevate your brand
- Take your business to the next level
- Supercharge your growth
- Transform your online presence
- Game changer
- Look no further
- Ready to grow?
- Whether you are
- It is more important than ever
- In the ever-evolving world
- Harness the power of
- Say goodbye to
- The key to success

These force a **regeneration**, not a repair: the phrase is a symptom that the
sentence has no content to keep.

Also avoid, as openings: a rhetorical question, or restating the service name.
Open with a specific observation.

## Content formats

Support genuine variation:

educational explanation · useful tip · common mistake · FAQ answer ·
myth versus fact · checklist introduction · process explanation · comparison ·
service benefit · local insight · trust-building explanation ·
soft promotional post · opinion or observation · problem and solution ·
practical recommendation

**A seven-day plan must normally use at least four different formats.** Seven
service adverts is the failure this exists to prevent.

## Platform differences

The message may be consistent. The writing must not be copied.

**Facebook** — conversational and informative. Slightly more context. Natural
paragraphs. Restrained hashtags (at most ~3). A useful CTA.

**Instagram** — a stronger opening line, because that is all most people see.
Easy-to-scan paragraphs. Useful information, not only promotional copy.
Restrained relevant hashtags. The visual headline and the post copy must support
each other.

**Threads** — shorter and more conversational. One useful thought. No copied
Instagram formatting, no sign-off block. Hashtags only where genuinely useful.

## Headline and copy must not duplicate each other

The image headline is the **claim**. The post copy carries the **reasoning, the
caveats, and the next step**. If the copy restates the headline, one of them is
redundant.

A reader who sees only the image should get a complete thought. A reader who
reads the copy should get *more*, not the same again.

## Duplicate prevention

Compare against: the current batch, recent drafts, recent approved posts, queued
posts, and published posts where available.

Check all of:

- opening paragraph
- sentence structure
- topic angle
- headline
- service
- format
- CTA wording
- hashtags
- conclusion

**Changing a few words is not enough.** Two posts about the same service with the
same angle, the same opening shape and the same structure are the same post.

Legitimate reuse — do not flag these on their own:

- the same approved brand CTA
- the same business service
- the same hashtags

Those are brand consistency. Flag when the **angle, opening and structure**
repeat as well. `contentUniquenessService` implements this split: caption /
headline / opening are strong signals that fail a post alone; topic / CTA /
hashtags only count in combination.

If similarity is still too high after regeneration: mark the item **Needs
rewrite**, never auto-approve it, and state the **largest actual cause** — not
the most eye-catching one.

## Review before approving a plan

Ask, per post:

- Does it have a useful purpose?
- Are the paragraphs readable?
- Does it sound human?
- Is the business context real, or generic filler?
- Is it more than an advertisement?
- Are the platform versions meaningfully adapted, not trimmed copies?
- Are all em and en dashes gone?
- Are openings and conclusions different across the week?
- **Could a professional business publish this as-is?**

Reject weak posts and regenerate them. A post that passes the schema and fails
this list is still a failure.
