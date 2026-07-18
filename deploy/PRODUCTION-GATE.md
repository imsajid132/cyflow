# Production gate

**This is not a production deployment guide.** It exists to stop staging being
copied to production, and to name what changes between them.

Production requires explicit user approval that has not been given.

## What must not be copied from staging

| Item | Why copying it is wrong |
| --- | --- |
| Database target | Obvious, and the most damaging mistake available. Verify the target before every command that writes. |
| `PUBLIC_BASE_URL` | Wrong origin breaks OAuth and secure cookies, and can send production users to staging. |
| OAuth callback URIs | Must point at the production origin, registered with each provider. Staging callbacks will hand sessions to the wrong environment. |
| Secure cookies | Production must be HTTPS with `trust proxy` correct for the real terminator. Wrong, and either cookies are dropped or client IPs are spoofable — which silently disables rate limiting. |
| Persistent paths | Production media and export paths are separate from staging. Sharing them means staging tests can delete production images. |
| `ENCRYPTION_KEY_BASE64` | **Must be its own key, and must never change once data exists.** Every per-user OpenAI key, HCTI credential and social token is encrypted with it. Changing it in place makes all of them permanently unreadable. Rotating requires re-encrypting stored rows first. |
| `SESSION_SECRET` | Its own value. Sharing it lets a staging session be replayed against production. |
| Provider credentials | Production Meta app, production tokens, real Pages and accounts. Never a customer's account for testing. |
| Worker persistence | Production must supervise the worker as its own process, with alerting on the heartbeat. |
| Scheduler cadence | One mode only, same rule as staging, and the consequence of getting it wrong is duplicate posts on real business pages. |

## Three things that cannot be rolled back

1. **A published post exists on the platform.** A database restore only makes
   Cyflow forget it sent it, which is worse — the next run may send it again.
   Delete it on the platform first.
2. **A completed account deletion is permanent.** Credentials are erased and
   media unlinked. A restore may resurrect rows whose files no longer exist.
3. **An encryption key rotated in place destroys every stored credential.**

## Live publishing rollout

Deploy production with `ENABLE_LIVE_PROVIDER_PUBLISHING=false`.

Every publishing path is verified against fake providers and **none against a
real one**. With the flag off, users get drafting, scheduling, media,
automations, export and deletion, while the one irreversible action stays behind
a switch. Enable it deliberately, one provider at a time, after a real staging
test of that provider.

The failure mode of enabling it early is not an error message. It is a post on a
real business's page.

## Approval required before any production action

- [ ] release commit approved
- [ ] maintenance window agreed
- [ ] production database backup taken **and verified**
- [ ] production media backup taken and verified
- [ ] environment reviewed against `.env.example`
- [ ] persistent paths confirmed to survive redeploy
- [ ] web, worker and scheduler setup confirmed
- [ ] migration order 010 → 017 confirmed
- [ ] staging results reviewed
- [ ] per-provider verification status reviewed
- [ ] initial live-publishing state agreed (**recommend `false`**)
- [ ] rollback plan accepted, including its three irreversible cases
