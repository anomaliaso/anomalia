# Security

## Reporting a vulnerability

**Do not open a public issue, PR or discussion for a security problem.**

Use GitHub's private vulnerability reporting: the **Security** tab of this repository →
**Report a vulnerability**. It creates a private advisory only you and the maintainers can read,
and it is the only channel we watch for this.

If that button isn't there, open a normal issue that says nothing but "security report, please
enable private reporting" and wait — no details, no reproduction, no logs in the open.

What helps, in rough order of usefulness:

- what an attacker gets (read another tenant's rows, run code, spend someone's credits, …)
- the smallest reproduction you have: a request, a route, a curl
- the commit or version you tested
- whether you touched anything you shouldn't have, so we know what to check in the logs

Please don't run automated scanners against the hosted product, don't pull data belonging to
someone else, and don't test denial of service. A single proof-of-concept request that shows the
bug is worth more than a dump, and it keeps the report on the right side of the law.

## Response times

This project is maintained by a very small team, so these are commitments we can actually keep:

| | |
|---|---|
| First human reply | within 5 business days |
| Assessment (confirmed / not a bug / need more) | within 10 business days |
| Fix for a confirmed critical issue | as fast as we can — days, not a release cycle |
| Public disclosure | after a fix ships, credited to you unless you'd rather not be |

If you get no reply in 10 business days, ping the advisory again — assume it got lost, not
ignored.

There is no bug bounty. We say thank you and we credit you.

## Scope

**In scope**

- Anything in this repository: the SvelteKit app, `src/routes/api/v1/**`, the agent packages in
  `packages/**`, the SQL in `supabase/migrations/**`, the compose stack in `infra/compose/**`.
- Cross-tenant access of any kind — this is a multi-tenant product and every table is supposed to
  be scoped by brand through row-level security. A read or write across that line is the most
  serious class of bug here, always.
- Authentication and session handling, one-tap approval links (`APP_SECRET`), the cron/worker
  endpoint secrets, and anything that lets an unauthenticated caller spend AI credits.
- Secrets reachable from the browser: `SUPABASE_SERVICE_ROLE_KEY` or any private env value leaking
  into a client bundle.

**Out of scope**

- Findings that require a self-hosted operator to have misconfigured their own instance — but read
  [`docs/SELF_HOSTING.md`](./docs/SELF_HOSTING.md) first, because the security posture and its
  known gaps are documented there, and a gap we documented badly *is* in scope.
- The publishable/anon Supabase key appearing in the client bundle. It is public by design; RLS is
  what protects the data. A way *around* RLS is very much in scope.
- Third-party services we broker but don't run (Supabase, Vercel, Stripe, Composio, the model
  providers). Report those to them; tell us if our integration is what makes it exploitable.
- Missing hardening headers, rate limits or best-practice warnings with no demonstrated impact,
  automated-scanner output pasted without a reproduction, social engineering, and physical access.

## For self-hosters

You run your own instance, your own keys and your own database, so the security of that instance
is yours. Two things in the guide are worth reading twice before you put anything in front of a
reverse proxy: the cron/worker endpoints are only fail-closed in a production build (under
`npm run dev` the check is skipped by design), and the compose stack ships with Supabase's
published demo keys until you mint your own.
