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
| Anomalia MCP is connected | Call MCP tools (`list_brands`, `query`, `create_post`, …) |
| MCP not available | Shell: `anomalia …` after `anomalia login` |

Never invent REST endpoints or API keys.

## Auth (always OAuth)

**Signing in is not a tool** — there is nothing to call. Two paths, and both end in the same JWT:

1. **Local MCP / CLI:** run `anomalia login` in a terminal, once. The session lands in
   `~/.config/anomalia/session.json` and the CLI and the MCP server share it.
2. **Remote MCP** (`https://mcp.anomalia.so/mcp`): your host does the OAuth round itself — it reads
   `/.well-known/oauth-protected-resource` and answers the `401 WWW-Authenticate: Bearer`
   challenge. Nothing for you to do; a missing Bearer is a 401, not a broken server.

Confirm it worked with `list_brands`: brands come back, or you are not signed in.

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
5. **Read the brand's memory before asking the operator** something it may already know —
   `query` on `brand_memory` (the recipe is under Quick workflows) — and call
   `record_memory_used` with the ids that actually shaped your output. An entry nobody
   reports decays out of the prompts it was helping.
6. Confirm before reject / delete / discard unless the user clearly asked.
7. **A render is one shot.** Nothing looks at an image after the model draws it — no internal
   critic, no automatic retry, no second attempt you did not ask for. **You** are the quality
   control: open the `signed_url`, judge it, and when it is wrong call `refine_media` on that
   asset. Prompting again buys a different picture at a second render's price.

## Quick workflows

**The flow is linear**: generate the media → pass the id it returns to `create_post`. No post is
needed to make an image or a clip, and nothing you generate reaches the calendar on its own.

## Reading is one tool

**`query` is the read.** Every table in the database, **as you** — the request carries your own
session, so Postgres returns exactly the rows the app would show you and nothing more. Read only,
no credits, no model. Omit `table` to list what you can name; ask for a table with no `columns`
and the keys of a row are the schema.

**Always name `columns`.** Without them `query` returns every column, the character cap then drops
whole rows to fit, and a long question gets a short answer. Fifty posts asked for, nine returned;
the same read with five named columns returns all fifty.

**Nothing is out of reach.** `offset` is the next page — when rows were dropped, the reply tells
you which offset resumes. `count: "exact"` when the number IS the answer. `negate: true` on a
filter turns `is null` into `is not null`. `order` takes several columns and `nullsFirst`. `embed`
brings a related table along through its foreign key, with RLS applied to it too. Every cap that
bites is named in `limits` on the way back — none of them is silent.

**One row is a document.** With `limit: 1` long text comes back whole, which is how you read an
article before rewriting it. With many rows long values are cut at 2 000 chars and `limits` says
in which columns.

### The queries you will actually need

| you want | call |
|---|---|
| posts | `query({table:"posts", columns:["id","status","platform","caption","scheduled_for","published_at","created_at"], where:[{column:"status",op:"eq",value:"pending_user"}], order:[{column:"created_at",ascending:false}], limit:50})` |
| how many are waiting | `query({table:"posts", columns:["id"], where:[{column:"status",op:"eq",value:"pending_user"}], count:"exact", limit:1})` → read `total` |
| the calendar | `query({table:"posts", columns:["id","platform","caption","scheduled_for","slot","status"], where:[{column:"scheduled_for",op:"is",value:null,negate:true}], order:[{column:"scheduled_for",ascending:true}], limit:100})` |
| media library | `query({table:"brand_media", columns:["id","kind","mime","title","description","tags","short_code","created_at"], order:[{column:"created_at",ascending:false}], limit:100})` — the link to hand out is `https://anomalia.so/a/<short_code>` |
| articles | `query({table:"brand_articles", columns:["id","slug","title","status","scheduled_for","published_at","created_at"], order:[{column:"created_at",ascending:false}]})` |
| one article, whole, with its category and author | `query({table:"brand_articles", columns:["id","title","body_md","meta_title","meta_description","status","language"], where:[{column:"id",op:"eq",value:"…"}], embed:[{table:"blog_categories",columns:["name","slug"]},{table:"blog_authors",columns:["name"]}], limit:1})` |
| brand memory | `query({table:"brand_memory", columns:["id","key","value","category","confidence"], where:[{column:"layer",op:"neq",value:"session"},{column:"agent",op:"is",value:null}], order:[{column:"confidence",ascending:false}]})` |
| competitors | `query({table:"competitors", columns:["id","name","website","kind","rationale","handles","source"], order:[{column:"created_at",ascending:false}]})` |
| what the brand sells | `query({table:"products", columns:["id","title","kind","pricing","url","featured","images"]})` |
| the brand kit and its look | `query({table:"brand_kit", columns:["about","target_audience","brand_colors","logos","favicon_url","fonts","graphic_style","visual_style","visual_style_locked","ai_character","content_pillars"]})` |
| how the brand is supposed to sound, and its settings | `query({table:"brands", columns:["slug","name","plan","status","timezone","target_platforms","content_prefs","blog_config"], where:[{column:"slug",op:"eq",value:"<slug>"}], limit:1})` — voice, hashtags, radar and blog settings all live in those two jsonb columns |
| connected accounts | `query({table:"social_accounts", columns:["platform","username","display_name","profile_url","status","connected_at","bio_url"]})` |
| the editorial plan | `query({table:"editorial_plans", columns:["id","status","strategy","voice","cadence","platform_mix","weeks","created_at","activated_at"], where:[{column:"status",op:"eq",value:"active"}], limit:1})` |
| SEO / GEO audits | `query({table:"brand_geo_audits", columns:["id","created_at","tech_score","tech","share_of_voice","citations"], order:[{column:"created_at",ascending:false}], limit:12})` |
| the fixes those audits produced | `query({table:"brand_geo_artifacts", columns:["id","kind","title","format","body","status","target_path","source_finding"], where:[{column:"status",op:"eq",value:"draft"}]})` |
| keyword strategy | `query({table:"brand_seo_keyword_strategy", columns:["strategy","citations","updated_at"], limit:1})` |
| rank tracking | `query({table:"brand_tracked_keywords", columns:["id","keyword","locale","device","active"], where:[{column:"active",op:"is",value:true}]})` then `brand_rank_snapshots` filtered `tracked_keyword_id` |
| radar sources | `query({table:"brand_news_sources", columns:["id","kind","value","lang","active"], order:[{column:"created_at",ascending:true}]})` |
| share links you handed out | `query({table:"shared_views", columns:["id","view_type","created_at","expires_at","revoked_at"], order:[{column:"created_at",ascending:false}]})` — no token: it is shown once, at creation |
| is the knowledge indexed | `query({table:"brand_doc_chunks", columns:["id"], where:[{column:"embedding",op:"is",value:null,negate:true}], count:"exact", limit:1})` → `total` of 0 means nothing is searchable yet |
| did my clip land | `query({table:"video_renders", columns:["id","status","error","submitted_at"], order:[{column:"submitted_at",ascending:false}], limit:20})`, then `brand_media` filtered `source_ref` on that id — a `done` render with no media row never reached the library |

Those two `where` clauses on `brand_memory` are not decoration: they are the filters the old tool
imposed — no chat-session notes, no other agent's working notes. Drop them and you get both back.

### The reads that are NOT a query

Nine tools remain, and not one of them is a select. Reach for them by subject:
`list_brands` (where slugs come from), `diagnose_brand` (what blocks this brand, gate by gate),
`diagnose_radar` (asks every source live), `search_knowledge`, `get_writing_skills`,
`get_creation_kit`, `get_gsc`, `get_ads` (campaign fatigue), `get_media_models`.
Anything else you remember calling is now a `query`.

**A row in a table nothing else writes** → `insert_row` and `update_row`, `query` turned around.
`insert_row({table, values})` adds one row and fills in `brand_id` for you; a row that already
exists comes back naming the key you hit instead of replacing it. `update_row({table, where,
values})` touches **only the columns you send** and leaves the rest of the row alone, needs a
`where` that is never empty, and moves at most 50 rows a call — counted before writing, so
"nothing matched" is a refusal and not a quiet success. Neither can delete: deleting has its own
named tools. Prefer a named write when one exists — those also derive a field, attribute a source
or set off the side effect that the bare row does not carry.

**Ask what this brand already knows** → `search_knowledge` with the question. It reads the brand's
own uploaded documents and returns the passages that answer it, each with the document it came
from — not the whole corpus. Empty `hits` is not "the brand does not know": count the embedded
chunks with `query` (recipe above) to see whether anything has been indexed yet. No model, no credits.

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

**Reuse an asset instead of paying for a render** → `query` on `brand_media` → pass its id to `create_post`
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

**Make a carousel** → `generate_carousel` with a brief. It plans the series, draws every slide and
returns them in order plus the `continuity_tokens` that hold them together. One render per slide.
To fix a single slide afterwards, `refine_media` on its id **with those tokens in the instruction** —
without them that slide drifts out of the series. `slug` is OPTIONAL here too: without it the
slides take nothing from any brand (name the look in the brief), are filed nowhere, and their
`id`s come back `null`.

**Animate an image you already have** → `generate_video` with its `base_media_id`. That is how
"make a 5s clip of this photo" works, and it needs **no post**: the clip lands in the library and
`create_post` takes its id as `media_ids`. `make_video` animates the cover of a post you
already have and attaches the clip back to it — reach for it when you already have the post, not
to get a video.

**Film from nothing** → `generate_video` with a prompt and no `base_media_id`. A clip takes minutes,
so it returns a `job_id`; `query` on `video_renders` says when it landed. The model moves this bill by more
than an order of magnitude, so read `get_media_models` (slot `videoModel`, or `videoImageModel` when animating an image) before
spending. With a slug the clip follows this brand's visual direction, so you do not have to
describe it — and there is no switch for it here.

**Film without a brand** → `generate_video` with no `slug`. Same tool, and what changes is where
the clip ends up: no brand, no library, no `media_id` and nothing for `create_post`. The finished
clip lands on the job itself — `GET /api/v1/videos` (add `?job_id=` for one) and its `media_url`
is where the file is. `query` cannot see it: that tool reads a brand. Without a slug
`base_media_id` is the `storage_path` or `url` a brand-free generate handed you, never a library
id and never a web address.

**Give a post the image it is missing** → `render_post`. It draws from the prompt already written
on that post and attaches it. One render. To draw a picture that is not tied to a post, use
`generate_image` instead.

**Change the image already on a post** → `regenerate_post_media` with an instruction. It REPLACES
that post's image — one render, and the old one is gone. When you want to keep the original, use
`refine_media` on the library asset instead: that files the result as a new asset.

**CHANGE something you already made** → `refine_media` with its `base_media_id` and an
instruction ("make it red", "warmer background", "keep the movement but make it night"). One door
for every kind: an image or a video from the brand's **library**, and the asset's own kind picks
the engine — you never say which it is. It starts from that asset, so the result is that picture
or that clip changed. Do NOT reach for `generate_image` or `generate_video` to
alter something: a new prompt starts from nothing, pays for a fresh render, and gives you a
different subject — the commonest and most expensive mistake on this surface. The original is
never overwritten: refining files a new asset, so a wrong edit costs one render and not your
source. A clip needs the brand to have chosen a video refine model; until it has, `refine_media`
says `no_refine_model` instead of quietly filming a new one.

`slug` is OPTIONAL on `refine_media` as well, and then `base_media_id` means something else: the
`storage_path` (a picture) or the `url` (a clip) that a brand-free `generate_image`,
`generate_carousel` or `generate_video` handed back. Nothing else resolves — a library id has no
brand to be looked up in, and a web address is refused as `source_not_found` rather than fetched.
The result is filed nowhere either, `brand_style` is refused because there is no brand to apply,
and a clip has no brand preference to read, so pass `model` or it comes back `no_refine_model`.

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

**Keep the brand truth current from your own source** → `query` on `products`, `people`,
`competitors` and `brand_kit` returns every row with its id. `insert_row` adds an offer or a
row, `update_row` fixes a role or a wrong website, `delete_product` and the other deletes take one
away. A website wants its scheme — `example.com` is refused by `competitors_website_check`, not
corrected — and consent for a real person is the operator's act: never write `consent`,
`consent_at` or `consent_source` on `people`, because a real person's face stays withheld from
every generator until the operator states, in their own words, that they have it.
**Change how the brand works** → `query` on `brands` (`timezone`, `target_platforms`,
`content_prefs`) then `set_brand_settings`: posting timezone, target platforms, hashtags per platform, voice examples. Only the fields you send
change, and lists replace rather than merge. Two things to tell the person: changing the timezone
does not move posts that already have a time (their local hour shifts instead), and removing a
platform does not cancel posts already scheduled on it. If a target platform has no connected
account the write says so in `without_account` — its posts will be produced and then wait.

**Turn a recurring job on or off** → `set_automation` flips one, and its schema names the nine
included jobs. What each has been doing is `loop_ticks` read with `query`, filtered on `loop` and
`created_at`; `brand_job_optouts` says which are off. Turning one ON commits the brand to
recurring AI spend with nobody watching, so say which job, how often, and that it spends before
you do it. Turning one OFF is free and safe. There is no per-job cost figure — spend is not
attributable to one job — so describe the commitment with cadence and `runs_30d`, and never
invent a number.

**Point Radar at a new place** → `query` on `brand_news_sources` shows what is configured, and
`brands.content_prefs.radar` which platforms are on; `add_radar_source` / `remove_radar_source`
change them, naming a source by its `(kind, value)` pair, and their schemas carry the kinds.
Threads, X and LinkedIn are Pro-only and answer `plan_required`, so check the plan first. A source already there comes back
`added: false` rather than failing.

**Set up the blog** → `query` on `brands.blog_config` shows how it looks and how it writes, and
`blog_categories` / `blog_tags` / `blog_authors` the three lists; `set_blog_settings` changes it —
its schema carries the accepted fonts, layouts and locales, and it clamps to the plan and reports
back what was saved. and `add_blog_term` / `remove_blog_term` maintain the three lists. `articles_per_week`
is clamped to the plan, so read back what was saved. Before removing a term, say what it leaves
behind: a category leaves its articles unfiled, a tag comes off every article, an author leaves no
byline. `analytics` takes a closed list of providers (`ga4`, `meta_pixel`, `plausible`, `hotjar`)
with their id — there is no field for arbitrary JavaScript, and those trackers load only on a
verified custom domain, only after the visitor accepts cookies.

**Change what the brand IS, how it SOUNDS, how it LOOKS** → `update_brand_identity`, one door for
all of it: the facts every post is written from (`about`, `category`, `target_audience`,
`brand_style`, `language`), the voice (`mood`, `tone`, `register`, `avoid`,
`platform_instructions`), the `colors`, and the look — logo, favicon, graphic fonts, visual brief.
It took four tools — `update_brand_kit`, `update_voice`, `set_colors`, `set_appearance` — and the
split is why "change the brand's colours" opened the tool called appearance and found no colour
field. Only the fields you send change. `colors` REPLACES the whole palette, so send every colour
you want kept. A logo is given as a URL and is DOWNLOADED and re-hosted, so read back the address
it answers with. Fonts go in pairs and are checked against Google Fonts before saving — a family
it will not serve is refused rather than rendered as Inter. Setting `visual_style` locks it against
the nightly rebuild. Read what they are now from `brand_kit` with `query` (recipe under Quick
workflows — the real logo is the entry whose `type` is not `og-image`). The past posts the writer
imitates are `voice_examples` on `set_brand_settings`, not here. Free.

**Choose which model draws and which films** → `get_media_models` lists the six jobs (image
generation, image refinement, video from text, animating a still, video refinement, motion
transfer) with the models each one accepts; `set_media_model` pins one. A model that cannot do
that job is refused with the list that would have been taken, so read before you write. `null`
gives the job back to the platform default. No credits, no model call; it applies to the next
render.

**For ONE call only, pass `model` to the generator instead.** `set_media_model` is "from now on"
and changes the brand; `model` on `generate_image` or `refine_media` is "just this once" and
changes nothing. Drawing and refining are two different jobs with two different lists — read
`get_media_models` for the right one. The response says which model actually ran, so an agent that
chose nothing still knows what it got.

**Hand over a payment link** → `create_checkout_link` (pick a plan and pay) or
`create_billing_portal_link` (invoices, card, plan change, **cancel**). You mint the URL and give
it to the account owner; they complete it on Stripe. Never pay, never switch a plan, never cancel
on their behalf. The URL is a credential — hand it over once and keep no copy. Owner only, and it
costs no credits, which is the point: whoever ran out is who needs it.

**Approve pending posts** → `query` on `posts` (status `pending_user`) → `approve_posts`.

**Send a client the calendar, the month at a glance, or the month's results** → `create_share`
(`view`: `calendar`, `dashboard`, `monthly_report`, `strategy` or `workspace` — `workspace` puts all four behind one link). It returns a link they open with no account, showing a frozen snapshot of that
view and nothing else. The token is in the response **once** — hand over the `url` immediately.
`query` on `shared_views` shows what is out there, `revoke_share` turns one off without touching anyone's
access to the brand.

**Fix one carousel slide** → `query` on `posts` for its `media_urls` → `regenerate_slide` (`index`, instruction; 0 = cover).

**Blog draft** → `generate_article` → optional `optimize_article` → `publish_article` when asked.

**Make the copy sound like this brand** → `query` on `brands.content_prefs` for how it is supposed
to sound — mood, tone, register, the words it avoids, the rules that change per platform — and
`update_brand_identity` to change any of them. This is the brand; `get_writing_skills` is the craft. Read both before writing.

**Do ChatGPT, Perplexity and Google's AI mention this brand?** → `query` on `brand_geo_audits`
reads the last answer for free: `share_of_voice`, and `citations` is the question-by-question
evidence behind that number. `geo_action` with `audit` asks the engines again and `fix` writes the
pages that would get it cited — both spend credits.

**Back a SEO/GEO claim with the audit behind it** → `query` on `brand_geo_audits`: `tech` holds
what the crawl observed, `citations` the probes behind the share of voice (engine, question asked,
verdict, domains cited), and `brand_geo_artifacts.body` the fix, verbatim. All free: never run a
new audit just to see what a past one already measured.

**Write or fix an article yourself** → `query` on `brand_articles` with `limit: 1` to read it
whole — one row is a document, so `body_md` is not truncated — then `update_article` to write
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
