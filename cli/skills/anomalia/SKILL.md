---
name: anomalia
description: >-
  Operate Anomalia (social media AI autopilot) via MCP tools or the anomalia CLI:
  brands, posts, plans, studio, SEO/GEO, blog, and AI chat. Use when the user
  mentions Anomalia, anomalia.so, approving social posts, editorial plans,
  SEO/GEO audits, or managing brand content from an agent.
license: Apache-2.0
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

1. Almost every tool acts on ONE brand and needs its **slug**; `list_brands` (or `anomalia
   brands`) is where slugs come from. When you do not know which brand, **ask the person** —
   never call `list_brands` to pick one yourself. Guessing spends a real organisation's
   credits and writes into a real client's library.
2. Pass `slug` on every brand-scoped call.
3. Post/article ids accept **short unambiguous prefixes** from list output — never guess if ambiguous.
4. **Before writing ANY copy** — caption, carousel, script, article, bio — call
   `get_writing_skills`. It returns the craft text Anomalia writes with, plus this brand's own
   procedures. Skipping it is how output starts reading as generated.
5. **Read `get_memory` before asking the operator** something the brand may already know — and
   call `record_memory_used` with the ids that actually shaped your output. An entry nobody
   reports decays out of the prompts it was helping.
6. Confirm before reject / delete / discard unless the user clearly asked.
7. **A render is one shot.** Nothing looks at an image after the model draws it — no internal
   critic, no automatic retry, no second attempt you did not ask for. **You** are the quality
   control: open the `signed_url`, judge it, and when it is wrong call `refine_image` on that
   asset. Prompting again buys a different picture at a second render's price.

## Quick workflows

**The flow is linear**: generate the media → pass the id it returns to `create_post`. No post is
needed to make an image or a clip, and nothing you generate reaches the calendar on its own.

**When no tool answers the question** → `query`. It reads any table in the database **as you** —
the request carries your own session, so Postgres returns exactly the rows the app would show you
and nothing more. Read only, one table per call, no credits. Omit `table` to list what you can
name; ask for a table with no `columns` and the keys of a row are the schema. Reach for it for a
count, a join you do by hand, or a fact none of the tools below returns — instead of three calls
that approximate it.

**Ask what this brand already knows** → `search_knowledge` with the question. It reads the brand's
own uploaded documents and returns the passages that answer it, each with the document it came
from — not the whole corpus. Empty `hits` is not "the brand does not know": `get_knowledge_status`
says whether anything has been indexed yet. No model, no credits.

**Before you write anything** → two reads, and they answer different questions.

`get_writing_skills` is **how to write**: `humanizer` and `stop-slop` always, `social` or
`seo-audit` depending on `agent`, plus the brand's own procedures (`source: "brand"`, and those
overrule a product skill when they disagree). Bodies come inline; references are listed by path
and fetched one at a time with `reference: "<skill>/<path>"`. A few thousand tokens, no credits —
and the difference between copy a person would publish and copy that reads as generated.

`get_creation_kit` is **what to say** — with the goal, the platforms and the format.
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

**Draw a new image** → `generate_image` with a prompt — "an image of a cat", a product shot, a
background. `slug` is OPTIONAL: leave it out for a one-off drawing (no brand, filed nowhere, `id`
comes back `null`, and a signed `url` that expires), pass it when the picture belongs to a brand
or is going to become a post. With a slug the brand's own look — colours, fonts, visual direction —
is applied by default; `brand_style: ignore` leaves it out when the picture must take nothing from
the brand. Do NOT call `list_brands` to decide where to draw: if nobody named
a brand there is no brand, and guessing one spends a real organisation's credits. It bills a
render per image and creates nothing in the calendar, so ask for two or three with `count`, look
at them, keep one.

**If you reach for `generate_media`** — the older door — it still works and forwards to
`generate_image` and `generate_video`. Prefer those two: they name what they do, and changing a
picture or animating one has its own tool.

**Make a carousel** → `generate_carousel` with a brief. It plans the series, draws every slide and
returns them in order plus the `continuity_tokens` that hold them together. One render per slide.
To fix a single slide afterwards, `refine_image` on its id **with those tokens in the instruction** —
without them that slide drifts out of the series.

**Animate an image you already have** → `generate_video` with its `base_media_id`. That is how
"make a 5s clip of this photo" works, and it needs **no post**: the clip lands in the library and
`create_post` takes its id as `media_ids`. `make_video` animates the cover of a post you
already have and attaches the clip back to it — reach for it when you already have the post, not
to get a video.

**Film from nothing** → `generate_video` with a prompt and no `base_media_id`. A clip takes minutes,
so it returns a `job_id`; `check_media_job` says when it landed. The model moves this bill by more
than an order of magnitude, so read `get_media_models` (slot `videoModel`, or `videoImageModel` when animating an image) before
spending. With a slug the clip follows this brand's visual direction, so you do not have to
describe it — and there is no switch for it here.

**Give a post the image it is missing** → `render_post`. It draws from the prompt already written
on that post and attaches it. One render. To draw a picture that is not tied to a post, use
`generate_image` instead.

**Change the image already on a post** → `regenerate_post_media` with an instruction. It REPLACES
that post's image — one render, and the old one is gone. When you want to keep the original, use
`refine_image` on the library asset instead: that files the result as a new asset.

**CHANGE an image you already have** → `refine_image` with its `base_media_id` and an instruction
("make it red", "warmer background"). It starts from that asset, so the result is that picture
changed. Do NOT reach for `generate_image` to alter something: a new prompt draws a new picture
from scratch, pays for a fresh render, and gives you a different subject — the commonest and most
expensive mistake on this surface. The original is never overwritten: refining files a new asset,
so a wrong edit costs one render and not your source.

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
**Change how the brand works** → `get_brand_settings` then `set_brand_settings`: posting
timezone, target platforms, hashtags per platform, voice examples. Only the fields you send
change, and lists replace rather than merge. Two things to tell the person: changing the timezone
does not move posts that already have a time (their local hour shifts instead), and removing a
platform does not cancel posts already scheduled on it. If a target platform has no connected
account the write says so in `without_account` — its posts will be produced and then wait.

**Turn a recurring job on or off** → `get_automations` lists the nine included jobs with their
cadence, state and `runs_30d`; `set_automation` flips one. Turning one ON commits the brand to
recurring AI spend with nobody watching, so say which job, how often, and that it spends before
you do it. Turning one OFF is free and safe. There is no per-job cost figure — spend is not
attributable to one job — so describe the commitment with cadence and `runs_30d`, and never
invent a number.

**Point Radar at a new place** → `get_radar` shows the platforms, the configured sources, the
kinds this plan allows and how many sources are left; `add_radar_source` / `remove_radar_source`
change them, naming a source by its `(kind, value)` pair. Threads, X and LinkedIn are Pro-only and
answer `plan_required` below it, so read before you write. A source already there comes back
`added: false` rather than failing.

**Set up the blog** → `get_blog_settings` shows how it looks, how it writes, the accepted fonts,
layouts and locales, the plan's ceilings, and the categories, tags and authors; `set_blog_settings`
changes it, and `add_blog_term` / `remove_blog_term` maintain the three lists. `articles_per_week`
is clamped to the plan, so read back what was saved. Before removing a term, say what it leaves
behind: a category leaves its articles unfiled, a tag comes off every article, an author leaves no
byline. `analytics` takes a closed list of providers (`ga4`, `meta_pixel`, `plausible`, `hotjar`)
with their id — there is no field for arbitrary JavaScript, and those trackers load only on a
verified custom domain, only after the visitor accepts cookies.

**Change how the brand looks** → `get_appearance` reads the logo, favicon, palette, the two Google
Fonts graphics are composed with and the visual brief; `set_appearance` changes them. A logo is
given as a URL and is DOWNLOADED and re-hosted, so read back the address it answers with. Fonts go
in pairs and are checked against Google Fonts before saving — a family it will not serve is refused
rather than rendered as Inter. Setting `visual_style` locks it against the nightly rebuild.
Colours stay with `set_colors`.

**Choose which model draws and which films** → `get_media_models` lists the six jobs (image
generation, image refinement, video from text, animating a still, video refinement, motion
transfer) with the models each one accepts; `set_media_model` pins one. A model that cannot do
that job is refused with the list that would have been taken, so read before you write. `null`
gives the job back to the platform default. No credits, no model call; it applies to the next
render.

**For ONE call only, pass `model` to the generator instead.** `set_media_model` is "from now on"
and changes the brand; `model` on `generate_image` or `refine_image` is "just this once" and
changes nothing. Drawing and refining are two different jobs with two different lists — read
`get_media_models` for the right one. The response says which model actually ran, so an agent that
chose nothing still knows what it got.

**Hand over a payment link** → `create_checkout_link` (pick a plan and pay) or
`create_billing_portal_link` (invoices, card, plan change, **cancel**). You mint the URL and give
it to the account owner; they complete it on Stripe. Never pay, never switch a plan, never cancel
on their behalf. The URL is a credential — hand it over once and keep no copy. Owner only, and it
costs no credits, which is the point: whoever ran out is who needs it.

**Approve pending posts** → `list_posts` (status pending) → optional `get_post` → `approve_posts`.

**Send a client the calendar, the month at a glance, or the month's results** → `create_share`
(`view`: `calendar`, `dashboard`, `monthly_report`, `strategy` or `workspace` — `workspace` puts all four behind one link). It returns a link they open with no account, showing a frozen snapshot of that
view and nothing else. The token is in the response **once** — hand over the `url` immediately.
`list_shares` shows what is out there, `revoke_share` turns one off without touching anyone's
access to the brand.

**Fix one carousel slide** → `get_post` → `regenerate_slide` (`index`, instruction; 0 = cover).

**Blog draft** → `generate_article` → optional `optimize_article` → `publish_article` when asked.

**Make the copy sound like this brand** → `get_voice` for how it is supposed to sound — mood,
tone, register, the words it avoids, the rules that change per platform — and `update_voice` to
change any of them. This is the brand; `get_writing_skills` is the craft. Read both before writing.

**Do ChatGPT, Perplexity and Google's AI mention this brand?** → `get_geo` reads the last answer
for free: share of voice, which answers cited the brand, and fixes already written. `geo_action`
with `audit` asks the engines again and `fix` writes the pages that would get it cited — both
spend credits. `list_audit_citations` is the question-by-question evidence behind the number.

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
