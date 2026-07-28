# Meta App Review — the path to "anyone can press Allow"

The owner's requirement, recorded on 2026-07-28 and treated as fixed:

> Any user, anywhere, presses Connect and sees a plain Allow button.

**This cannot be done in code.** While the Meta app is Unpublished, Meta itself
refuses everyone who has no role on the app, with "App not active" on Meta's own
page. The user never reaches this application, so nothing here can catch it,
explain it, or work around it. The only route is App Review and a published app.

The chain is fixed and each step gates the next:

```
Business verification → Tech Provider → App Review (per permission)
                                              ↓
                                    Advanced Access → App published Live
                                              ↓
                                  ✅ any user → Allow → connected
```

---

## Before you can even submit

**Business verification.** Meta asks for documents proving a registered business:
legal name, address, and something official that matches (registration
certificate, utility bill, bank statement). If there is no registered business
yet, that is the first blocker, and it is not a small one. Find this out now
rather than after building a submission.

**Tech Provider.** The dashboard now requires this before App Review can be
submitted for access to other businesses' data. It is where verification is
completed.

---

## What Meta looks at, and where we stand

| Requirement | State | Note |
| --- | --- | --- |
| Privacy Policy URL | ✅ `/privacy` | Rewritten 2026-07-28 to describe what the software actually stores, sends and deletes. |
| Terms of Service URL | ✅ `/terms` | Rewritten the same day. |
| A working contact email | ❌ | `hello@cyflowsocial.example` is a placeholder. `.example` is reserved for documentation and mail to it goes NOWHERE. Reviewers send a message here; a bounce is a rejection. One constant in `public/assets/js/pages/marketing.js` — `CONTACT_EMAIL`. |
| Data deletion callback | ⚠️ partial | Threads has one, with confirmation codes (`POST /oauth/threads/data-deletion`, `GET /oauth/threads/data-deletion/status/:code`). Facebook/Instagram need either the same or a Data Deletion Instructions URL. |
| Deauthorize callback | ⚠️ partial | Threads has `POST /oauth/threads/uninstall`. |
| App icon, category, description | ⚠️ | Set in the Meta dashboard, not here. |
| HTTPS everywhere | ✅ | The site is https. |
| The app actually works | ✅ | One post published live to a real Page on 2026-07-28, end to end. |

---

## The permissions to request, and why

Ask for the minimum and justify each one in terms of the user's own goal.
Reviewers reject vague answers ("to improve the experience") far more often than
narrow ones.

| Permission | Why this app needs it |
| --- | --- |
| `pages_show_list` | So the user can choose WHICH of their own Pages a week of posts goes to. Without it there is nothing to select. |
| `pages_read_engagement` | So a publish that fails can be reported to the user with the real reason instead of a silent failure. |
| `pages_manage_posts` | The product's entire purpose: publishing the posts the user reviewed and approved, at the time they chose. |
| `instagram_business_basic` | To identify the Instagram Professional account being connected and show the user which one it is. |
| `instagram_business_content_publish` | To publish the approved post to that account. |
| `threads_basic` | To identify the Threads profile being connected. |
| `threads_content_publish` | To publish the approved post to it. |

---

## The screencast

Meta asks for a recording per permission, and rejects ones that show a mock or
skip the login. Record ONE continuous take on the live site:

1. Sign up as a brand-new user (not an existing session).
2. Connections → Connect Facebook → the real Meta dialog → Allow → back in the
   app with the Page listed. This is the part reviewers are actually checking.
3. AI Studio → paste a website → Analyze → the brand appears.
4. Generate a week → the seven posts build.
5. Show a poster and its captions; use Regenerate once so it is clearly live.
6. Choose the Page, a timezone and a time → Activate.
7. Show the Queue with the scheduled posts, then the post itself ON the Facebook
   Page.

Step 7 is the one that answers "what do you do with the permission". Do not cut
it.

---

## Order of work

1. **A real contact mailbox.** Cheapest item on this list and a hard blocker.
2. **Find out whether business verification is possible** (is there a registered
   business?). Everything else is wasted if not.
3. Data deletion + deauthorize callbacks for Facebook and Instagram.
4. Run the product for a few real users via App roles → Tester, and fix what
   they hit. A submission backed by a working product with real usage is a
   different submission.
5. Record the screencast, write the justifications, submit.

Step 4 is not a detour. Meta asks what the app does and expects to see it doing
it; a rejection costs another round of weeks, so going once with something
proven beats going early with something thin.
