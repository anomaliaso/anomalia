# Anomalia MCP tools ↔ CLI

All tools take a brand `slug` when brand-scoped. Ids accept short unambiguous prefixes, except
on a delete: `delete_product`, `delete_person`, `delete_document`, `delete_competitor` and
`delete_article` take the full UUID, because an ambiguous prefix would remove the wrong row and
nothing brings it back.

## Auth

| MCP | CLI |
|-----|-----|
| `login` | `anomalia login` |
| `logout` | `anomalia logout` |
| `whoami` | (session file / brands imply identity) |
| `list_brands` | `anomalia brands` |

## Database

| MCP | CLI |
|-----|-----|
| `query` | (MCP only) |

`query` reads ANY table in the database directly, **as you**: the request runs with your own
session, so Postgres RLS returns exactly the rows you would see in the app and nothing more. It
is READ ONLY by construction — you name a table, columns and filters, it issues one PostgREST
read, and a write has nowhere to go. No SQL string, no joins, no function calls. It calls no
model and costs nothing.

Optional `table` (omit it and you get the list of every table you can name), `columns` (omit them
and you get real rows with every column — the keys of a row ARE the schema), `where` (filters
ANDed together, each `column` / `op` / `value`, where `op` is one of `eq`, `neq`, `gt`, `gte`,
`lt`, `lte`, `like`, `ilike`, `is`, `in`, `cs`, `cd`), `order` and `limit` (20 by default, 100 at
most). One table per call: read two and match the ids yourself.

Reach for it when the answer needs a count, a join you do by hand, or a table nothing else
exposes — that is one call instead of three that approximate it. A refusal comes back as `200`
with `error`, `message` and often `fix` inside, so you can read why and change move.

## Brand & posts

| MCP | CLI |
|-----|-----|
| `get_dashboard` | `anomalia dashboard <slug>` |
| `get_status` | `anomalia status <slug>` |
| `get_analytics` | `anomalia analytics <slug>` |
| `get_calendar` | `anomalia calendar <slug> [--month YYYY-MM]` |
| `diagnose_brand` | (MCP only) |
| `get_goals` | (MCP only) |
| `get_gtm` | `anomalia gtm <slug>` |
| `get_voice` / `update_voice` | `anomalia voice <slug>` |
| `list_products` | (studio / products views) |
| `list_posts` | `anomalia content <slug> [--status …]` |
| `get_creation_kit` | (MCP only) |
| `create_post` | (MCP only) |
| `list_media` | (MCP only) |
| `check_content` | (MCP only) |
| `import_media_url` | (MCP only) |
| `generate_media` | (MCP only) |
| `generate_image` | (MCP only) |
| `refine_image` | (MCP only) |
| `check_media_job` | (MCP only) |
| `approve_posts` | `anomalia approve <slug> --all` |
| `get_post` | `anomalia post <slug> <id>` |
| `edit_post` | `anomalia post <slug> <id> edit …` |
| `approve_post` / `publish_post` / `reject_post` | `anomalia post <slug> <id> approve\|publish\|reject` |
| `reschedule_post` | `anomalia post <slug> <id> reschedule --scheduledFor …` |
| `render_post` | `anomalia post <slug> <id> render` |
| `regenerate_post_media` | `anomalia post <slug> <id> regenerate --instruction "…"` |
| `regenerate_slide` | `anomalia post <slug> <id> slide --index N --instruction "…"` |
| `reorder_slides` | `anomalia post <slug> <id> reorder --order "0,2,1"` |
| `make_video` | `anomalia post <slug> <id> video …` |

`diagnose_brand` answers "why is nothing happening". For each recurring cycle — publishing,
autopilot, analytics review — it names the FIRST gate the brand fails (`blockedBy`), what the
data says (`detail`), what unblocks it (`fix`, present only on a failing gate), and the last
recorded outcome. Read `notCovered` before concluding anything: it lists the cycles this
diagnosis does not look at, so "no blocks" never means "the whole product is working". No model,
no credits, no writes.

`get_goals` is goal mode measured rather than described: `summary` says how many goals were met
on the first pass, how many went back to the person, how many automatic laps were spent, and
`stopped_by` says why the chains stopped. Each goal carries its criteria and its diary. `limit`
is 20 by default and 100 at most; `thread` narrows to one conversation.

`get_creation_kit` is what you read BEFORE writing. Required: `slug`, `goal` (one line saying
what the post has to do), `platforms` (comma-separated) and `format` (`single_image`, `carousel`,
`text_post`, `link_post`, `video`). It calls no model, spends no credits and writes nothing.

It answers with only the sections that have something in them — an absent key means the brand has
nothing there, so do not go looking for it elsewhere:

- **constraints** — per requested platform: `char_limit`, `needs_media`, `video_only`; plus the
  brand's `avoid` list. Never dropped.
- **brand** — name, language, about, audience, the products closest to your goal, and only the
  people the brand may depict — a real person who attested consent, or an AI persona.
- **voice** — the brand's approved personality when set, otherwise the house voice. Write to it.
- **rubric** — the approved recurring series matching your format, with its art direction. When
  present, this post is an episode of it.
- **template** — ONE structure for your format and platform, its hook family, and the playbook for
  exactly the platforms you asked about. The format decides first: a `video` job always gets the
  reel structure, never a carousel's slide plan. The goal only picks where the format leaves a
  real choice.
- **calendar** — the minutes already taken, with the campaign they belong to. Do not double-book.
- **week** — the current editorial week's theme.
- **operator_edits** — real before → after rewrites by the owner. Absorb the difference, never the
  wording: it belongs to other posts.
- **history** — what has worked on this brand: best times, formats, hashtags, cadence, the opening
  lines that won, and `untested_hooks` — angles this brand has never opened with.

`size_bytes` / `budget_bytes` / `trimmed` say how big the kit is and what, if anything, was
dropped to fit. Everything selected carries a stable id, and `versions.kit` pins the ruleset.

Past winners are evidence, not orders: they may suggest a direction, they never override a brand
fact or authorize copying. When two things conflict, platform constraints win, then the operator's
instruction for this artifact, then brand facts and voice, then the rubric, then the template.

`list_media` lists what is already in the brand library; an id from there goes into `create_post`
as `media_ids` and costs no render. Pass the **full** id: unlike a post id, a media id is never
resolved from a prefix. A media id that is not this brand's stops the creation — the post is
never made without it.

The two media failures of `create_post` mean opposite things. `media_not_found` (400) is yours:
the id is not this brand's, so check it against `list_media`. `media_unavailable` (502) is ours:
the media is this brand's and we could not attach it. Trying other ids, a shorter id or another
platform changes nothing — retry later, or create the post without the media.

`import_media_url` puts an image or video you made elsewhere into that same library, and returns
the id `create_post` accepts. Required: `slug`, `url`; optional `title`. Anomalia copies the file
and calls no model, so it spends no credits. The URL must be public **https** and stay public
across every redirect: a private, loopback or link-local target — including a public hostname
that resolves to one, and a redirect that walks into one or drops back to http — is refused as
`blocked_host`. Accepted types are jpeg, png, webp, gif (up to 12MB) and mp4, mov, webm (up to
64MB); anything else is `unsupported_type`, anything bigger is `too_large`. Every refusal happens
before a byte is stored, so a rejected import leaves nothing behind. The result carries the id,
the resolved `source_url` kept as the asset's origin, and a `signed_url` you can open to check
that the right file arrived.

`generate_media` makes a NEW image or video and puts it straight into the brand library — no
post, nothing in the calendar. Required: `slug`, `prompt`; optional `kind` (`image` default, or
`video`), `count`, `aspect_ratio`, `title`. **This spends credits**, unlike `import_media_url`:
every image is a paid render and every video a paid clip. `count` draws up to 4 alternatives in
one call and bills each one, so generate a few, look at them with `list_media`, and pass only the
id you keep to `create_post` as `media_ids` — the calendar stays clean either way.

An image comes back finished: `status` is `ready` and `media` carries the rows, each with a
`signed_url` you can open. A video cannot: it takes minutes, longer than any single call may
last, so it comes back with `status` `rendering` and a `job_id`, and `check_media_job` says where
it got to. Do not call `generate_media` again for the same clip while one is still rendering —
that bills a second one. Refusals: `credits_exhausted` (402) means the brand's pool is empty and
nothing was drawn; `video_budget_exhausted` (400) means the monthly video allowance is used up,
counting the clips still rendering; `render_failed` (502) is the model returning nothing, and
nothing is stored; `store_failed` (502) means it was drawn but could not be filed.

`generate_image` draws a NEW image into the library from a prompt. Required: `slug`, `prompt`;
optional `count` (1-4 alternatives, **each one billed**), `aspect_ratio`, `model`, `title`. It
bills a render per image — roughly 8 credits each — and creates nothing in the calendar, so ask
for two or three, look at them with `list_media`, and pass only the id you keep to `create_post`.
The response carries two facts worth reading. `model` is the model that **actually** drew it,
after the brand's choice and the platform default — read it rather than assuming your request won,
because an environment override can still outrank it. `renders` is how many renders were **billed**,
which can exceed the images you got back: a render that succeeds and is then discarded downstream
is paid for all the same, so trust `renders` over your own count when reconciling spend.

**One prompt, one render, no safety net.** Nothing inspects the image after the model draws it:
there is no quality control, no critic that rejects a bad frame, no retry you did not ask for.
What comes back is what was billed, however crooked. Judging it is YOUR job — open the
`signed_url`, look, and if it is wrong send it to `refine_image` rather than prompting again.

`refine_image` changes an image that is already in the library and files the result as a **new**
asset — the original is never overwritten, so a refinement cannot destroy what it started from.
Required: `slug`, `media_id` (from `list_media`, and it must belong to this brand — anything else
is `source_not_found`), `instruction`. Say what should CHANGE, not what the whole picture should
be. Refining has its own model slot, `imageRefineModel`.

**Choosing the model.** Every generator takes an optional `model` that applies to **that call
only** and changes no brand setting — that is the difference from `set_media_model`, which is "from
now on". The ids each job accepts come from `get_media_models`, which also names the job each slot
does; anything else is refused as `model_not_for_slot`, and the refusal carries `allowed`, the list
that would have been taken. The choice moves the bill: a light image model and a heavy video model
are two orders of magnitude apart, so read the list before spending.

`check_media_job` reads those jobs back, newest first. Required: `slug`; optional `job_id` for
one of them. Each row carries `status` (`rendering`, `done`, `failed` or `expired`), `error` when
it failed, and `media_id` once the clip is in the library — that id is what `create_post` takes
as `media_ids`. It calls no model and spends no credits, so poll it rather than guessing.

`create_post` stores copy **you** wrote: Anomalia calls no model and spends no credits. It does
not publish and does not schedule — `scheduled_for` is the proposed calendar time and stays a
proposal until `approve_post`, which is what authorizes distribution. Text-capable platforms
only (`facebook`, `linkedin`, `x`, `threads`, `bluesky`, `reddit`) unless you pass `media_ids`;
`instagram` and `tiktok` need an image, `youtube` a video. Required: `slug`, `platforms`, `caption`. Optional:
`platform_captions`, `scheduled_for` (ISO — no offset means the brand's timezone), `title`
(required for Reddit), `subreddit`, `link_url`. The result carries the post id, its
`pending_user` status, the stored instant and a `review_url` the operator can open.

`check_content` runs the checks Anomalia runs on its own copy against a spec you wrote, before
you create anything. It calls no model, spends no credits and writes nothing, so the same spec
always returns the same verdict. Required: `slug`, `platforms`, `caption`. Optional:
`platform_captions`, `media_ids`, `title`, `scheduled_for` — the fields that carry a rule.

It answers with `ok`, `errors`, `warnings`, `scores` and `versions`:

- **errors** block: `no_platforms`, `caption_empty`, `caption_placeholder`, `caption_needs_proof`
  (a `[NEED: …]` marker — supply the fact, never delete the marker), `need_media`, `need_video`,
  `over_limit`, `reddit_title`, `media_not_found`, `invalid_scheduled_for`, `too_soon`. Each one
  names the `field` to repair.
- **warnings** do not block: `calendar_conflict` (that minute is already taken),
  `reach_chasing_hashtags`.
- **scores** carry, per platform, the 0–100 quality index and the twelve weighted checks with a
  note each — hook, AI tells, self-repetition against the brand's recent posts, specificity, CTA,
  length, readability, hashtags, emoji. Fix the low value with the highest weight first.
- **versions** pins the ruleset and the scorer: two verdicts compare only when they match.

It reads the copy and nothing else. **No tool here judges an image or a video** — Anomalia stopped
scoring them, and there is no paid action that will. Looking at the render is on you.

## Client links

| MCP | CLI |
|-----|-----|
| `create_share` | (MCP only) |
| `list_shares` | (MCP only) |
| `revoke_share` | (MCP only) |

`create_share` freezes one view as a snapshot and returns a link a client opens with no account.
Required: `slug`, `view` (`calendar`, `dashboard`, `monthly_report`, `strategy` or `workspace`). Optional: `month` (`YYYY-MM`, default
the current month on the brand clock) and `expires_in_days` (1–365; without it the link lasts
until revoked).

The `token` comes back **once**, in the create response, and is never stored in readable form —
save the `url` right away. A link you did not save cannot be recovered: revoke it and make
another.

The link grants that snapshot and nothing else. It is not a reduced account: it exposes no
connectors, notes, prompts, costs, settings, member data or private identifiers, and it never
re-reads live data — what it shows is what the snapshot held the day it was created. The calendar
shows `planned` / `published`, never the internal workflow state.

`list_shares` shows what exists (`live`, `revoked`, `expired`) without any token.
`revoke_share` turns one off by `id`: from then on it answers exactly like a link that never
existed, and brand membership is untouched.

Both need the `shared_views` table. Until it is migrated the three tools answer
`shares_not_migrated` and name the file to apply.

## Plans

| MCP | CLI |
|-----|-----|
| `get_plan` | `anomalia plan <slug>` |
| `propose_plan` / `revise_plan` / `approve_plan` / `discard_plan` | `anomalia plan <slug> propose\|revise\|approve\|discard` |
| `save_brief` / `replan_week` | `anomalia plan <slug> save-brief\|replan --week N …` |
| `get_weekly_plan` | `anomalia weekly-plan <slug>` |
| `plan_week` / `produce_week` | `anomalia weekly-plan <slug> plan\|produce --week N` |
| `save_plan` | (MCP only) |
| `save_week_seeds` | (MCP only) |

`propose_plan` and `plan_week` ask Anomalia's model to write the strategy and the week's rows,
and they bill it. `save_plan` and `save_week_seeds` are the other half: you wrote them, Anomalia
only stores them — no model call, no credits. Both paths land in the same place, so a saved plan
is reviewed, approved and produced exactly like a generated one.

`save_plan` deposits the plan as the brand's **pending proposal**. The active plan is left alone:
`approve_plan` stays the step that activates one, and saving replaces an earlier pending proposal,
never an active plan. Required: `strategy`, `voice` (`mood`, `tone`, `goal`, `personality`),
`cadence` (`3/week`, `5/week`, `daily`), `platform_mix` (`platform`, `share`, `role`), and
`weeks` — up to 4, each with `theme`, `focus` and a `content_mix` whose counts are the week's
volume. Optional per week: `rationale`, `brief`, `products`. Optional `gtm`. A short cycle is
padded to 4 weeks, like a generated one.

`save_week_seeds` deposits the week's rows — one per planned post, no copy and no image yet.
Required: `week_index` (0–3), `theme`, `seeds` (each needs `platform` and `angle`). Optional per
seed: `platforms`, `pillar`, `format`, `media`, `slide_count`, `day`, `time`, `subject`,
`setting`, `props`, `product`, `person`, `title`, `subreddit`, `link_url`, `art_direction`,
`sourced_from`, and the video script (`hook`, `hook_visual`, `hook_text`, `body`, `cta`, `ugc`).
A brand keeps one draft in review, so saving replaces the one that is there (`replaced` says so).
`produce_week` is the separate, paid step that turns the rows into posts.

## Memory

| MCP | CLI |
|-----|-----|
| `get_memory` | (MCP only) |
| `save_memory` | (MCP only) |
| `record_memory_used` | (MCP only) |

`get_memory` is what the brand already knows, so you stop asking the operator things it has
already answered: its voice, the constraints it works under, the facts it confirmed, the
preferences it stated, what previous work learned. `category` narrows to one kind; `limit` is 50
by default, 200 at most. Chat-session notes and other agents' working notes never come out — only
what belongs to the brand.

**Reading is not using.** The read changes nothing and counts nothing. When an entry actually
shaped what you produced, say so with `record_memory_used` and the ids you used — a handful, not
everything you read. That counter is what keeps a working entry alive: entries nobody reports
decay out of the prompts they were helping.

`save_memory` records what you learned, so the next conversation starts from it. Writable:
`fact`, `preference`, `insight`, `skill`. **`voice` and `constraint` are not** — they govern
everything downstream, and only the operator sets them from the app.

A `key` that already holds a DIFFERENT value answers **409 with both values and writes nothing**:
you take the disagreement to the operator, you do not win it by arriving last. Sending the same
value again reinforces it instead. Entries arrive with the confidence of something a model
inferred, not something a person stated, and are never scoped to a chat.

## Writing

| MCP | CLI |
|-----|-----|
| `get_writing_skills` | (MCP only) |

**Call this before writing any copy.** It returns the craft text itself, not a pointer to it:
`humanizer` and `stop-slop` always — why the output must not read as a chatbot — plus `social`
(captions, carousels, hooks, platform limits) or `seo-audit` depending on `agent`. Omit `agent`
for the writing deck alone; `content` and `ugc` add `social`, `web` adds `seo-audit`.

It also returns the **built-in production skills** for that agent — the ones that name the gates
which refuse a render (`motion-voiceover-fit`, `graphic-feed-legibility`, and the rest). Write a
motion script without them and `make_video` gets refused with no explanation.

And it returns this brand's OWN procedures — what its team wrote down or the system distilled
from repeated lessons. `source` tells product from brand, and **a brand procedure overrules a
product skill when the two disagree**: the product skill is how everyone writes, the brand
procedure is how this one does.

Bodies arrive inline. Each skill lists its `references` by path without sending them; fetch one
with `reference: "social/references/platform-limits.md"`, which returns that file alone and no
deck. No credits, no writes.

## Studio

| MCP | CLI |
|-----|-----|
| `get_studio` | `anomalia studio <slug>` |
| `update_brand_kit` / `set_colors` | `anomalia studio <slug> kit-update\|colors …` |
| `add_note` / `delete_document` | `anomalia studio <slug> add-note\|delete-doc …` |
| `add_person` / `generate_person` / `delete_person` | `anomalia studio <slug> people-*` |
| `update_person` | (MCP only) |
| `add_competitor` / `delete_competitor` / `research_competitors` | `anomalia studio <slug> add-competitor\|…\|research` |
| `update_competitor` | (MCP only) |
| `create_product` / `update_product` / `delete_product` | (MCP only) |
| `get_bio` / `set_bio` | (MCP only) |
| `sync_history` | `anomalia studio <slug> sync-history` |

`get_studio` lists documents **without their text**. Each carries `status`, `chunkCount` and
`textBytes`: the text exists, its size is stated, and it does not travel. To answer a question,
call `search_knowledge` — it returns the passages that answer it with the document each came
from. `documents: "full"` restores `content_text` on every document; it is there for callers
that read it before and is almost never what you want.

`create_product` adds ONE offer. The e-commerce resync behind `sync_products` replaces the whole
catalog and would erase a hand-made row.

`update_product`, `update_person` and `update_competitor` change only the fields you send: every
other column keeps the value it had. An id from another brand answers `not_found`, exactly like
one that does not exist anywhere. The four deletes want the UUID in full, verbatim from
`get_studio` or `list_products`.

`update_person` cannot attest consent, turn a real person into an AI persona, or touch photos. A
real person's face stays withheld from every generator until the operator states the consent in
their own words.

`set_bio` records the link in bio; no publishing API writes a profile bio, so a person still
pastes it on the profile by hand. `get_bio` also returns the short link worth putting there — the
one with the most clicks in the last seven days.

## Knowledge

| MCP | CLI |
|-----|-----|
| `search_knowledge` | (MCP only) |
| `get_knowledge_status` | (MCP only) |

`search_knowledge` asks the brand's OWN documents a question and returns the passages that answer
it — not a list of files. Every hit carries where it came from (`documentId`, `title`,
`headingPath`, `chunkId`), so a claim can be attributed instead of asserted. Retrieval is hybrid
over what is already indexed: keywords first, one embedding of the question only when keywords
come up short. No credits, no writes.

Passages are cut at 1500 characters and `truncated` says when there is more; `limit` is 6 by
default and 20 at most, so ask a narrow question several times rather than a wide one once.
`collection` narrows to a shelf: `brand`, `product`, `commercial`, `legal`, `operations`,
`research`.

Empty `hits` is not the same as "the brand does not know this": read `get_knowledge_status`
before concluding anything.

`get_knowledge_status` says whether the knowledge is USABLE, not just uploaded. `documents`
counts the pipeline stage by stage — `pending` → `processing` → `ready` | `failed` — and
`indexed` is the only number retrieval can see: a `ready` document with zero chunks is not
searchable. `chunks.embedded` below `chunks.total` means retrieval is running on keywords alone,
so a paraphrase misses. `failures` names each broken document and WHY it broke, `collections`
says which shelves are worth narrowing to, and `sources` says which connected apps feed the
corpus and when each last synced.

So: `search_knowledge` empty + `searchable: true` → the brand does not know it, go add a
document. Empty + `pending`/`failed` above zero → it may already know it and nobody has read the
file yet. Two opposite situations, two opposite actions.

## Brand settings

| MCP | CLI |
|-----|-----|
| `get_brand_settings` | (MCP only) |
| `set_brand_settings` | (MCP only) |

How the brand works: posting `timezone`, target `platforms`, `hashtags` per platform, and
`voice_examples` (real past posts the AI imitates for tone). `set_brand_settings` changes only the
fields you send; `hashtags` and `voice_examples` **replace** the whole list, so send the full list,
not a delta — `{}` and `[]` clear one.

Two consequences to say out loud before you change either of the first two:

- **Timezone.** A post that already has a time does not move. It keeps firing at the same absolute
  instant, so its local hour shifts by the offset difference — 18:00 in Rome reads as 12:00 once
  the brand moves to New York. Only new scheduling uses the new zone.
- **Platforms.** The target list decides what NEW posts are made for, never what publishes.
  Removing a platform does not cancel posts already scheduled on it: they still go out while their
  account is connected.

`get_brand_settings` also returns `connected_platforms`, and the write answers with
`without_account`. Targeting a platform with no connected account is allowed and silent otherwise:
posts for it are produced and then sit unpublished until an account exists. Say so when it happens,
and reach for `list_social_accounts` — it reads the same accounts and is the only place that says
*why* a platform is missing.

An unknown IANA zone is refused (`unknown_timezone`), and so is a platform outside the list —
`twitter` is not a name here, it is `x`. The post language lives on `update_brand_kit`, not here.

## Recurring jobs

| MCP | CLI |
|-----|-----|
| `get_automations` | (MCP only) |
| `set_automation` | (MCP only) |

The nine jobs included with the product — `autopilot`, `analytics_review`, `weekly_recap`, `seo`,
`geo`, `radar_recap`, `market_refs`, `strategy_review`, `library` — with what each does, its
cadence, whether it is on, how it went last time, whether it is behind, and `runs_30d`: how many
times it actually ran in the last 30 days (runs a gate stopped are not counted, because they spent
nothing).

**Turning one ON is a spending decision, not a preference.** From that moment the job runs by
itself on its cadence, and every run calls AI models and spends the brand's credits, with nobody
looking. Before you turn one on, say which job it is, how often it will run, and that it spends —
to the person whose credits they are. Turning one OFF spends nothing, takes effect at the next
tick, and destroys nothing: it is the safe direction, so do not make it hard.

`get_automations` deliberately does **not** report a cost per job, and that is not an omission to
work around: AI spend is logged per call with no column naming the job, and the same labels are
shared between jobs, so any per-job figure would be invented. Use `runs_30d` with `cadence` to
describe the commitment, and point at the usage page for the brand-wide bill.

A brand without a paid plan runs none of them however many are on — `scheduled_work_allowed` says
so. The calls themselves spend no credits.

## Radar sources

| MCP | CLI |
|-----|-----|
| `get_radar` | (MCP only) |
| `set_radar_platform` | (MCP only) |
| `add_radar_source` | (MCP only) |
| `remove_radar_source` | (MCP only) |

Where Radar looks: which platforms are on (`gnews`, `reddit`, `threads`, `x`, `linkedin`) and
which sources are configured (`gnews_query`, `rss`, `subreddit`, `reddit_query`, plus
`threads_query`, `x_community`, `linkedin_query`).

**Read `get_radar` first.** It carries the two things you cannot guess: `allowed_kinds` for this
plan, and `source_limit` against `sources_used`. Threads, X and LinkedIn belong to the **Pro**
plan — below it they read as `plan_locked` and both writes answer `plan_required` (403). Past the
limit, `add_radar_source` answers `source_limit` (403) and names the ceiling.

A source is identified by the pair **(kind, value)** — there is no id to remember, and it is what
`remove_radar_source` takes. Adding one that is already there is not an error: nothing changes and
`added: false` says so. `rss` must be an http(s) URL; a subreddit is stored without its `r/`, and
both writes normalise it the same way, so `r/coffee` and `coffee` are the same source.

Adding a source spends no credits by itself, but Radar reads it on every run from then on.
Removing one is permanent and stops Radar reading it; what it already found stays.

## Blog settings

| MCP | CLI |
|-----|-----|
| `get_blog_settings` | (MCP only) |
| `set_blog_settings` | (MCP only) |
| `add_blog_term` | (MCP only) |
| `remove_blog_term` | (MCP only) |

How the blog looks (name, colour, font, layout, nav links, whether it is live) and how it writes
(style brief, articles per week, languages, humanising pass), plus the categories, tags and
authors an article can be filed under.

**Read `get_blog_settings` first.** It carries `choices` (the fonts, layouts and locales that are
accepted) and `limits` (the plan's ceiling on articles per week, how many extra languages it
allows, whether a custom domain is available).

`set_blog_settings` changes only the fields you send. `articles_per_week` is **clamped** to the
plan ceiling rather than refused, so read `config` back from the answer instead of assuming your
number was taken. A locale the blog does not serve is refused (`unknown_locale`) rather than
dropped. `locales` and `navbar_links` replace their whole list.

`add_blog_term` takes `term`: `category`, `tag` or `author`. The slug is derived from the name and
must be unique for the brand — a clash answers `slug_taken` (409), not a second row. `description`
belongs to a category, `bio` and `role` to an author; sending one to the wrong list is refused
(`field_not_for_term`), not ignored.

`remove_blog_term` deletes no article, but each kind leaves a different mark — say which before
you do it: a **category** leaves its articles filed under nothing, a **tag** comes off every
article that carried it, an **author** leaves their articles with no byline. The answer counts
`articles_affected`.

`analytics` is a **closed** list of providers with their measurement id — `ga4` (`G-XXXXXXX`),
`meta_pixel` (numeric), `plausible` (a domain), `hotjar` (numeric). There is no field for arbitrary
JavaScript and there will not be one: a script tag here runs on every visitor's page, and on the
default `/blog/<slug>` address that page is served from Anomalia's own origin, alongside the
session of anyone signed into `/app`. Those trackers therefore load **only on a verified custom
domain** and **only after the visitor accepts cookies**; on `/blog/<slug>` they are stored and
never emitted. Sending `analytics: []` takes them all off a live site without us.

The blog icon and an author's avatar are images and cannot be set through these tools.

## Brand appearance

| MCP | CLI |
|-----|-----|
| `get_appearance` | (MCP only) |
| `set_appearance` | (MCP only) |

The look every render follows: logo, favicon, colour palette, the two Google Fonts graphics are
composed with, and the visual brief.

**Read `get_appearance` first** — a font it does not carry is a font Google Fonts will not serve,
and the graphics would silently come out in Inter.

`logo_url` and `favicon_url` are **downloaded and re-hosted**, not linked: the answer carries the
address we stored, which is the one every graphic will use. A private, redirecting or oversized
address is refused (`image_rejected`) rather than half-saved, and `remove_logo` clears the logo —
the two cannot be combined (`logo_conflict`). `display_font` and `body_font` go together
(`font_pair_incomplete`) and are checked against Google Fonts before saving (`font_not_available`,
which names the missing family). Setting `visual_style` **locks** it: the nightly rebuild stops
rewriting the brand's visual brief until someone regenerates it from the browser.

Colours stay with `set_colors` (three or six hex digits, up to 8 — the list replaces the palette).

## Media models

| MCP | CLI |
|-----|-----|
| `get_media_models` | (MCP only) |
| `set_media_model` | (MCP only) |

Six jobs a brand can hand to different models: `imageModel` (draw an image), `imageRefineModel`
(redraw one that exists), `videoModel` (clip from words alone), `videoImageModel` (animate a
still), `videoRefineModel` (rewrite a clip, keeping its movement), `videoMotionModel` (take
movement from a guide video). They are not rungs of one ladder — a model that animates a photo
may have no video input at all, so each job offers only the models that do it.

`get_media_models` returns, per job, the current choice and the ids that job accepts.
`set_media_model` takes `slot` and `model`; a model that job cannot do comes back as
`model_not_for_slot` (400) with the list that would have been accepted, and nothing is saved.
`model: null` drops the choice and the platform default renders again. `model` is always
required — there is no way to leave it unsaid.

Neither call spends credits or runs a model. The choice applies to the next render, not to
anything already produced. It is stored on the brand, so it is the same for everyone working on
that brand.

The motion video written in code (Remotion/TSX) has no model choice of its own: it is a program
rendered in a VM, not a generative model, and no per-brand preference exists for the model that
writes it.

## SEO / GEO / blog / ads / AI

| MCP | CLI |
|-----|-----|
| `get_seo` / `seo_action` | `anomalia seo <slug> [run\|plan\|…]` |
| `get_geo` / `geo_action` | `anomalia geo <slug> [run\|fix]` |
| `list_web_audits` | (MCP only) |
| `get_audit_findings` | (MCP only) |
| `list_audit_citations` | (MCP only) |
| `list_web_fixes` | (MCP only) |
| `get_keywords` / `refresh_keywords` | `anomalia keywords <slug> [refresh]` |
| `get_gsc` | (MCP only) |
| `get_ranks` | (MCP only) |
| `get_backlinks` | (MCP only) |
| `list_articles` / `generate_article` / `optimize_article` | `anomalia web <slug> …` |
| `get_article` / `update_article` | (MCP only) |
| `publish_article` / `unpublish_article` / `delete_article` | `anomalia web <slug> publish\|…` |
| `get_ads` / `ads_action` | `anomalia ads <slug> [--propose\|--create\|--approve\|--pause\|--resume\|--duplicate\|--delete\|--reject] [--ad <adId>]` |
| `ads_remix` | (MCP only) |
| `get_market_field` | (MCP only) |
| `diagnose_radar` | (MCP only) |
| `list_ideas` | (MCP only) |

`get_market_field` is what the brand's field is doing, not what the brand is doing: the topics
being watched, the playbook distilled from them, and the catalogued posts each with a teardown —
tone, format, hook, what made it spread, what is transferable and what to avoid. `limit` caps the
posts (20 by default, 50 at most). A field never watched answers with `topics`, `playbook` and
`updatedAt` at `null`: that is a state, not an error, and it means the weekly pass has not run
for this brand yet.

`diagnose_radar` answers "why does Radar find nothing". It fetches every configured source live
and reports, per source, how many items came back — or `skipped` (source off, plan, platform
toggle) or `error` (the endpoint failed). It spends no credits and writes nothing, but it does
leave the building: one network request per source, so it can take seconds. Dynamic keyword
searches are not probed here.

`list_ideas` is the brand's idea bank — the disruptive ideas agents saved while working. Omit
`status` and you get only the ones still usable (`new` and `shortlisted`); pass `all`, or one of
`new` / `shortlisted` / `used` / `archived`, for the rest. `limit` is 50 by default, 200 at most.
Each idea carries the contrast `device` it uses, `why_it_contrasts` and `who_it_annoys` — an idea
that annoys nobody is not one.

`get_seo` and `get_geo` answer on the **latest** audit. The four web tools let you trace a claim
back to what was actually measured, without paying for a new audit. All four are reads: they call
no model, spend no credits and write nothing.

`get_gsc`, `get_ranks` and `get_backlinks` are the measured side of the same brand. `get_gsc`
reads Google Search Console over the last 28 days — clicks, impressions, top queries and top
pages — and says whether the property is connected at all: `connected: false` means there is
nothing to read yet, not that the brand ranks nowhere. `get_ranks` returns the tracked keywords
with `position`, `prevPosition` and `delta` (positive = moved up), the ranking URL, and
`hasAiOverview` for the ones where Google answered on its own. `get_backlinks` returns links
given and received plus the open give/receive opportunities, and `unlocked` tells you whether
the network is usable — it needs Starter or above **and** the brand's opt-in, so `planAllowed`
and `enabled` say which of the two is missing. All three are reads: no model, no credits, no
writes.

`ads_remix` is the opposite: it **spends credits**. It harvests the competitor and trending ads
already collected for the brand, looks at them with vision, and returns ranked remix briefs in the
brand's voice — `rank`, `strategy`, `keep`, `change`, `hook`, `headline`, `body`, `cta`,
`productName`, `visualPrompt`. It takes `slug` and nothing else, and it **replaces** the briefs
that were there, so run it when you mean to redo them. Refusals: `no_competitor_ads` (400, nothing
harvested yet — there is nothing to remix), `no_remix_briefs` (400, the pass produced none),
`ads_not_on_plan` (403) and `credits_exhausted` (402). Launching an ad is still `ads_action`; this
only writes the briefs.

`list_web_audits` is the index of every audit, newest first — `id`, `at`, `tech_score`,
`share_of_voice`, `citability_score`, `binding_constraint`, and how many citations and findings
the audit holds. Optional `limit` (12 by default, 24 at most) and `offset`.

`get_audit_findings` opens one audit. `technical`, `search`, `backlinks` and `ai_overview` come
back exactly as recorded. Without `audit_id` you get the newest audit, never an older one that
happens to hold more data; an audit outside the brand answers `audit: null`.

`list_audit_citations` returns the probes behind the share of voice for one audit, paginated with
`limit` (50 by default, 200 at most) and `offset`; each carries `observed_at`, `answer_engine`,
`question`, `brand_mentioned`, `rank`, `competitors`, `source_domains` and `error`. Same rule on
`audit_id`, and an audit outside the brand answers zero citations.

`list_web_fixes` returns generated fixes **with the body verbatim** — what `get_seo` and `get_geo`
only name. `surface` is `seo` for growth assets tied to a plan initiative, `geo` for citability
fixes. Filter with `fix_id` or `status` (`draft` / `accepted` / `dismissed`); bodies are long, so
`limit` defaults to 3 and stops at 10.

`get_article` returns one article **in full and in any state** — draft, planned, approved or
published: `body_md`, `meta_title`, `meta_description`, `cover_image`, `category`, `tags`,
`author`, `language`, `status`, `scheduled_for` (plus the brand-local reading) and
`translation_of`. `list_articles` only summarises; read this one before editing and again after.

`update_article` writes text and metadata you already have: `title`, `body_md` (the COMPLETE
markdown, a replacement not a diff), `meta_title`, `meta_description`, `category_id`,
`author_id`, `tag_ids` (the complete set — it replaces the current one), `language` (ISO 639-1),
`scheduled_for`. Anomalia calls no model and spends no credits; nothing is rewritten or
reformatted, and a field you do not send is left exactly as it was — changing the title never
touches the body, the cover or the description. Raw HTML inside `body_md` is stored as you sent
it and escaped by the public blog, so markdown is the only markup that renders.

Two halves with different weight: the text fields are safe, `scheduled_for` is consequential —
dating a draft moves it to `approved`, and `approved` is the status that auto-publishes. Pass
`null` to clear the schedule back to a draft.

Refusals name the field: `article_not_found` (an article of another brand included),
`no_changes`, `category_not_found`, `author_not_found`, `tags_not_found`, `invalid_language`,
`invalid_scheduled_for`, `planned_needs_slot` (a `planned` placeholder cannot lose its slot),
`translation_locked` (a translation's locale is its identity) and `article_published` — what is
live is never edited in place. To correct a published article: `unpublish_article`,
`update_article`, `publish_article`.
## Social accounts

| MCP | CLI |
|-----|-----|
| `list_social_accounts` | (MCP only) |
| `create_social_connect_link` | (MCP only) |

Where the brand actually publishes, and how a platform gets connected. This is **not**
`connections` / `list_integrations_tools`: those are Composio (Drive, Notion, GitHub, Gmail).
These two are the social accounts a post goes out on.

`list_social_accounts` returns one row per account — `platform`, `username`, `status` — plus
`connected_platforms` (at least one **active** account: the only ones a post leaves from),
`broken_platforms` (an account exists but none is active — expired, revoked, disconnected),
`can_connect`, `slots` (`used` / `limit` for the plan) and `manage_url`. `broken_platforms` is the
one thing no other tool shows, and it is usually the answer to "why hasn't this published?": the
post is scheduled, the platform is targeted, and the account stopped working weeks ago.

`create_social_connect_link` takes a `platform` and answers with the **URL a person opens** to
authorise it. You never run the OAuth, never see a token, never connect anything: you hand the URL
over and stop. Unlike a billing link it is not a credential — it is a page of our own app behind
their login — but it is only useful to someone who can already reach the brand. Minting a link for
a platform that is already connected is fine and comes back with `already_connected: true`: that
is how an expired account gets re-authorised or a second one added.

`platform` must be one of `platform_choices` — the same vocabulary as `set_brand_settings`, and
`twitter` is not in it, it is `x`. An unknown name is refused with `invalid_input` and the allowed
list in `platform_choices`.

Two refusals mean two different remedies: `plan_cannot_connect` (409) is a free, trial, paused or
export-only brand that connects no accounts at all — the body carries `activate_url`, which is
where the person starts; `account_limit` (409) is a plan whose slots are full, and the remedy is
`manage_url`, where they remove one. Neither call spends credits or touches a model.

**There is no tool to disconnect an account, on purpose.** Removing one stops scheduled
publishing without anyone noticing until a post fails to go out, and that is not a step an agent
takes on someone's behalf. `manage_url` is where a person does it.

## Billing links

| MCP | CLI |
|-----|-----|
| `create_billing_portal_link` | (MCP only) |
| `create_checkout_link` | (MCP only) |

Both mint a **one-time Stripe URL and hand it back**. You never pay, never change a plan, never
apply a discount and never cancel: you return the URL and stop, and the person completes the
action on Stripe's own hosted page. The portal is also where a subscription is **cancelled** —
say so when you hand the link over.

Treat the URL as a credential: whoever holds it reaches that customer's billing without logging
in. Give it to the account owner once, in the reply, and keep no copy of it anywhere.

`create_billing_portal_link` takes only `slug`: invoices, payment method, plan change, cancel.
`create_checkout_link` takes an optional `plan` and answers with the `plans` the hosted page will
offer, so you can name them in one line.

Only the **organization owner** can mint either one — reaching a brand is not authority over the
organization's money, and a collaborator gets `not_org_owner` (403). Neither call spends credits
or touches a model: an account out of credits is exactly who needs the link.

Refusals worth reading: `no_customer` / `no_subscription` (409) mean the organization never
subscribed — the body carries `app_billing_url`, which is where the person starts;
`stripe_unavailable` (502) and `no_org_billing` (500) are ours, so retrying with different input
changes nothing.
