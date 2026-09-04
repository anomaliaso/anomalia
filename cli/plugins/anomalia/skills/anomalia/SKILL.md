---
name: anomalia
description: >-
  Operate Anomalia (social media AI autopilot) via MCP tools or the anomalia CLI:
  brands, posts, plans, studio, SEO/GEO, blog, and AI chat. Use when the user
  mentions Anomalia, anomalia.so, approving social posts, editorial plans,
  SEO/GEO audits, or managing brand content from an agent.
license: AGPL-3.0-or-later
compatibility: >-
  Requires network access to anomalia.so (or PUBLIC_APP_URL). Prefer Anomalia MCP
  when connected; otherwise the anomalia CLI (Bun or installed binary) after OAuth login.
metadata:
  author: andreabuttarelli
  version: "1.0.0"
  homepage: https://anomalia.so
  repository: https://github.com/anomaliaso/anomalia
  mcp: https://mcp.anomalia.so/mcp
---

# Anomalia

Drive [Anomalia](https://anomalia.so) — social media AI autopilot — through **MCP tools**
(preferred) or the **`anomalia` CLI**. Same OAuth identity. **No static API tokens.**

## Choose interface

| Situation | Action |
|-----------|--------|
| Anomalia MCP is connected | Call MCP tools (`list_brands`, `list_posts`, …) |
| MCP not available | Shell: `anomalia …` after `anomalia login` |

Never invent REST endpoints or API keys.

## Auth (always OAuth)

1. **Local MCP / CLI:** shared session at `~/.config/anomalia/session.json`. MCP tool `login` opens the browser, or run `anomalia login`.
2. **Remote MCP** (`https://mcp.anomalia.so/mcp`): send `Authorization: Bearer <access_token>` (same JWT the CLI stores). Missing Bearer → 401.
3. Verify with `whoami` / `list_brands` or `anomalia brands`.

Setup details: [references/mcp.md](references/mcp.md).

## Operating rules

1. Start with `list_brands` (or `anomalia brands`) to learn **slugs**.
2. Pass `slug` on every brand-scoped call.
3. Post/article ids accept **short unambiguous prefixes** from list output — never guess if ambiguous.
5. Confirm before reject / delete / discard unless the user clearly asked.

## Quick workflows

**Before you write anything** → `get_creation_kit` with the goal, the platforms and the format.
It returns the smallest brief for that one job: platform limits, brand facts and approved voice,
the matching rubric, ONE template with its hook family, the operator's own rewrites, what has
worked on this brand, and which calendar minutes are taken. It is a selection, not the library —
sections with nothing in them are absent. Reads only: no model, no credits.

**Write a post yourself** → `create_post`. You write the copy; Anomalia stores it as
`pending_user` and calls no model. Creating does not publish: `scheduled_for` is the proposed
calendar time, and `approve_post` is what authorizes distribution. Hand the operator the
`review_url` that comes back.

**Reuse an asset instead of paying for a render** → `list_media` → pass its id to `create_post`
as `media_ids`. That is also how you post to Instagram or TikTok, which never accept text alone.

**Use a visual you made elsewhere** → `import_media_url` with its public https URL → pass the id
it returns to `create_post` as `media_ids`. The file is copied into the brand library, so the post
still has its image the day the original link dies.

**Check your copy before you create it** → `check_content` with the same spec you would send to
`create_post`. It returns blocking errors, warnings and a 0–100 score per platform, each naming
the field to repair. It costs nothing and calls no model, so run it on every draft and fix what
it names before creating.

**Write the plan yourself** → `save_plan`. You write the strategy, voice, cadence, platform mix
and the four weeks; Anomalia stores them and calls no model. It lands as the pending proposal —
the active plan is untouched, and `approve_plan` is what activates it. `propose_plan` remains
there for when you want Anomalia to write one and bill it.

**Plan a week yourself** → `save_week_seeds` (`week_index`, `theme`, one seed per planned post).
No model call, no credits. The rows become the week draft the plan page shows; `produce_week` is
the separate paid step that turns them into posts.

**Keep the brand truth current from your own source** → `get_studio` returns every row with its
id. `create_product` / `update_product` / `delete_product` maintain the catalog one offer at a
time; `update_person` and `update_competitor` fix a role or a wrong website. They change only the
fields you send, leave every other column as it was, and cost nothing. `update_person` can never
attest consent: a real person's face stays withheld from every generator until the operator
states, in their own words, that they have it.
**Hand over a payment link** → `create_checkout_link` (pick a plan and pay) or
`create_billing_portal_link` (invoices, card, plan change, **cancel**). You mint the URL and give
it to the account owner; they complete it on Stripe. Never pay, never switch a plan, never cancel
on their behalf. The URL is a credential — hand it over once and keep no copy. Owner only, and it
costs no credits, which is the point: whoever ran out is who needs it.

**Approve pending posts** → `list_posts` (status pending) → optional `get_post` → `approve_posts`.

**Send a client the calendar, the month at a glance, or the month's results** → `create_share`
(`view`: `calendar`, `dashboard` or `monthly_report`). It returns a link they open with no account, showing a frozen snapshot of that
view and nothing else. The token is in the response **once** — hand over the `url` immediately.
`list_shares` shows what is out there, `revoke_share` turns one off without touching anyone's
access to the brand.

**Fix one carousel slide** → `get_post` → `regenerate_slide` (`index`, instruction; 0 = cover).

**Blog draft** → `generate_article` → optional `optimize_article` → `publish_article` when asked.

**Back a SEO/GEO claim with the audit behind it** → `list_web_audits` to see every audit →
`get_audit_findings` for what one of them observed → `list_audit_citations` for the probes behind
the share of voice (engine, question asked, verdict, domains cited) → `list_web_fixes` for the fix
body, verbatim. All four are free reads: never run a new audit just to see what a past one already
measured.

**Write or fix an article yourself** → `get_article` to read it whole, `update_article` to write
your own title, markdown body, SEO fields, category, tags, author or schedule. No model, no
credits, and a field you do not send is untouched. A published article is refused: `unpublish_article`
first, then edit, then `publish_article`.

## References (load on demand)

- [references/mcp.md](references/mcp.md) — connect MCP (stdio / HTTP), Cursor config, auth
- [references/tools.md](references/tools.md) — full MCP tool catalog + CLI equivalents
- [references/cli.md](references/cli.md) — install CLI and common commands

## Install this skill

```bash
npx skills add anomaliaso/anomalia --skill anomalia
```

Or install the marketplace plugin (skill + remote MCP):

```bash
# Claude Code
/plugin marketplace add anomaliaso/anomalia
/plugin install anomalia@anomalia

# Codex
codex plugin marketplace add anomaliaso/anomalia
```

Or copy this folder into `.cursor/skills/anomalia/` / `~/.claude/skills/anomalia/`.  
Submit / packaging details: [`docs/plugins.md`](../../../../docs/plugins.md).
