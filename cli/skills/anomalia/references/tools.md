# Anomalia MCP tools ↔ CLI

All tools take a brand `slug` when brand-scoped. Ids accept short unambiguous prefixes, except
on a delete: `delete_product`, `delete_person`, `delete_document`, `delete_competitor` and
`delete_article` take the full UUID, because an ambiguous prefix would remove the wrong row and
nothing brings it back.

## Auth

| MCP | CLI |
|-----|-----|
| (none — the host does OAuth on HTTP, `anomalia login` locally) | `anomalia login` / `anomalia logout` |
| `list_brands` | `anomalia brands` |

There is no sign-in tool. On remote HTTP the host walks the OAuth round itself; on stdio the
session is the CLI's, so `anomalia login` in a terminal covers both. `list_brands` is how you
confirm: brands come back, or nobody is signed in.

## Reading is one tool

| MCP | CLI |
|-----|-----|
| `query` | (MCP only) |

`query` reads ANY table in the database directly, **as you**: the request runs with your own
session, so Postgres RLS returns exactly the rows you would see in the app and nothing more. It
is READ ONLY by construction — you name a table, columns and filters, it issues one PostgREST
read, and a write has nowhere to go. No SQL string, no joins, no function calls. It calls no
model and costs nothing.

Thirty-three reads that used to be tools of their own are this one call now. The REST endpoints
and the CLI commands did NOT move — only the MCP tools did — so where a command still answers the
question, the map below says so.

### The whole shape

- **`table`** — omit it and you get the list of every table you can name. Ask for a table with no
  `columns` and you get real rows with every column: the keys of a row ARE the schema.
- **`columns`** — **always name them.** Without them every column comes back, the character cap
  drops whole rows to fit, and a long question gets a short answer: fifty posts asked for, nine
  returned. The same read with five named columns returns all fifty.
- **`where`** — filters ANDed together, each `column` / `op` / `value`, where `op` is one of
  `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `cs`, `cd`. `in` takes an
  array, `is` takes null / true / false. **`negate: true` inverts that one filter**, which is how
  `is null` becomes `is not null`.
- **`order`** — one column or an array of them, applied in that order. Descending unless
  `ascending` is set, and `nullsFirst` decides where the empty values sit.
- **`embed`** — a related table brought along through its foreign key, with its own `columns`.
  RLS applies to it too: an article with its category and its author arrives in one call.
- **`offset`** — the next page. When rows were dropped, `limits` in the reply names the offset
  that resumes the read.
- **`count`** — `"estimated"` (the planner's guess, the default) or `"exact"`, which counts the
  matching rows for real and puts the number in `total`. Use it when the number IS the answer.
- **`limit`** — 20 by default, **200 at most**.

**One row is a document.** With `limit: 1` long text comes back whole — that is how you read an
article before rewriting it. With many rows long values are cut at 2 000 characters and `limits`
names the columns that were cut. Every cap that bites is named there; none of them is silent.

One table per call plus whatever `embed` brings: read two unrelated tables and match the ids
yourself. A refusal comes back as `200` with `error`, `message` and often `fix` inside, so you can
read why and change move.

It is also the read for questions no tool of its own answers. **What this brand sells** — its
catalogue of products, offers and services — is the `products` table: one row per offer, with
`title`, `kind`, `pricing`, `url`, `featured` and the `images` it carries.

### Where the reads went

| you want | how |
|---|---|
| posts, by status | `query` on `posts` — `id`, `status`, `platform`, `caption`, `scheduled_for`, `published_at`, `created_at`; CLI `anomalia content <slug> [--status …]` |
| one post, whole | the same read with an `id` filter and `limit: 1`; CLI `anomalia post <slug> <id>` |
| how many are waiting | `query` on `posts` with `status` `eq` `pending_user`, `count: "exact"`, `limit: 1` → read `total` |
| the calendar | `query` on `posts` — `id`, `platform`, `caption`, `scheduled_for`, `slot`, `status`, filtered `scheduled_for` `is` null with `negate: true`, ordered ascending; CLI `anomalia calendar <slug> [--month YYYY-MM]` |
| the brand at a glance | `anomalia dashboard <slug>` and `anomalia status <slug>` — no single table stands in for them |
| what publishing achieved | `anomalia analytics <slug>` |
| the media library | `query` on `brand_media` — `id`, `kind`, `mime`, `title`, `description`, `tags`, `short_code`, `created_at`; the link to hand out is `https://anomalia.so/a/<short_code>` |
| did my clip land | `query` on `video_renders` — `id`, `status`, `error`, `submitted_at` — then `brand_media` filtered on `source_ref` with that id |
| the editorial plan and its weeks | `query` on `editorial_plans` — `id`, `status`, `strategy`, `voice`, `cadence`, `platform_mix`, `weeks`, `created_at`, `activated_at`, filtered `status` `eq` `active`; CLI `anomalia plan <slug>` and `anomalia weekly-plan <slug>` |
| the go-to-market | `anomalia gtm <slug>` |
| how goal mode went | `GET /api/v1/brands/:slug/goals` — met on the first pass, laps spent, `stopped_by` |
| how the brand is supposed to sound, and its settings | `query` on `brands` — `slug`, `name`, `plan`, `status`, `timezone`, `target_platforms`, `content_prefs`, `blog_config` with `limit: 1`; voice, hashtags, radar and blog settings all live in those two jsonb columns. CLI `anomalia voice <slug>` |
| connected accounts | `query` on `social_accounts` — `platform`, `username`, `display_name`, `profile_url`, `status`, `connected_at`, `bio_url`; the link in bio is `bio_url` |
| the studio | `query` on `products`, `people`, `competitors` and `brand_kit`; CLI `anomalia studio <slug>`, `anomalia products <slug>`, `anomalia people <slug>` |
| is the knowledge indexed | `query` on `brand_doc_chunks` — `id`, filtered `embedding` `is` null with `negate: true`, `count: "exact"`, `limit: 1` → a `total` of 0 means nothing is searchable yet |
| SEO / GEO audits | `query` on `brand_geo_audits` — `id`, `created_at`, `tech_score`, `tech`, `share_of_voice`, `citations`, newest first; CLI `anomalia seo <slug>` and `anomalia geo <slug>` |
| the fixes those audits produced | `query` on `brand_geo_artifacts` — `id`, `kind`, `title`, `format`, `body`, `status`, `target_path`, `source_finding` |
| keyword strategy | `query` on `brand_seo_keyword_strategy` — `strategy`, `citations`, `updated_at` with `limit: 1`; CLI `anomalia keywords <slug>` |
| rank tracking | `query` on `brand_tracked_keywords` — `id`, `keyword`, `locale`, `device`, `active` — then `brand_rank_snapshots` filtered on `tracked_keyword_id` |
| the backlink network | `GET /api/v1/brands/:slug/backlinks` |
| articles | `query` on `brand_articles` — `id`, `slug`, `title`, `status`, `scheduled_for`, `published_at`, `created_at`; CLI `anomalia web <slug>` |
| one article, whole, with its category and author | `query` on `brand_articles` with an `id` filter, `limit: 1` and `embed` on `blog_categories` and `blog_authors` — `body_md` arrives untruncated |
| how the blog is configured | `query` on `brands` for `blog_config`, plus `blog_categories`, `blog_tags` and `blog_authors` for the three lists |
| radar sources | `query` on `brand_news_sources` — `id`, `kind`, `value`, `lang`, `active`; which platforms are on is `brands.content_prefs.radar` |
| what the recurring jobs have been doing | `query` on `loop_ticks` filtered on `loop` and `created_at`; `brand_job_optouts` says which are off |
| share links you handed out | `query` on `shared_views` — `id`, `view_type`, `created_at`, `expires_at`, `revoked_at`; no token, it is shown once at creation |
| what moves in the brand's field | `GET /api/v1/brands/:slug/market/field` |

Nine reads are NOT a query, because not one of them is a select: `list_brands`, `diagnose_brand`,
`diagnose_radar`, `search_knowledge`, `get_writing_skills`, `get_creation_kit`, `get_gsc`,
`get_ads` and `get_media_models`. Each has its own section below. Anything else you remember
calling is a `query`.
### Writing a row that has no tool of its own

| MCP | CLI |
|-----|-----|
| `insert_row` | (MCP only) |
| `update_row` | (MCP only) |

`insert_row` and `update_row` are `query` turned around: the same session, the same tables, the
same absence of SQL — and the same consequence, that what they cannot express does not happen.
There is no delete here and no upsert. **Deleting keeps its own named tools**, because a wrong read
hands you wrong rows while a wrong write takes yours away.

`insert_row({ table, values })` adds one row. `brand_id` is filled in with the brand you are on;
naming a different one is refused rather than quietly corrected. It never replaces anything: a row
that is already there comes back as a collision naming the key you hit, and changing it is the
other tool.

`update_row({ table, where, values })` changes rows that exist. **Only the columns you send are
touched** — everything else in the row is left exactly as it was, so you never resend a field you
are not changing, and you cannot blank one by omitting it. `where` is required and may not be
empty, at most 50 rows move per call, and the rows are counted before anything is written, so
"nothing matched" comes back as a refusal instead of a cheerful success.

Both refuse with `200` and an `error`, `message` and `fix` you can act on: a rejected value is
answered with the constraint AND the values it admits, a collision with the key you hit, a denial
with the columns this session may actually write. Read the row with `query` first when you are not
sure what you are about to overwrite — the old values do not come back.

Prefer a named tool when one exists. The named ones do more than the row: they derive a field,
attribute a source, kick a side effect. `add_competitor` records that a person added it and not
the AI; `add_note` rebuilds the brand context; `create_post` computes the slot from the calendar
date and the brand timezone. Reach for these two when nothing else covers the table.

## Brand & posts

| MCP | CLI |
|-----|-----|
| `diagnose_brand` | (MCP only) |
| `get_creation_kit` | (MCP only) |
| `create_post` | (MCP only) |
| `check_content` | (MCP only) |
| `generate_captions` | (MCP only) |
| `import_media_url` | (MCP only) |
| `generate_image` | (MCP only) |
| `refine_media` | (MCP only) |
| `generate_video` | (MCP only) |
| `generate_carousel` | (MCP only) |
| `approve_posts` | `anomalia approve <slug> --all` |
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

A `query` on `brand_media` lists what is already in the brand library; an id from there goes into
`create_post` as `media_ids` and costs no render. Pass the **full** id: unlike a post id, a media
id is never resolved from a prefix. A media id that is not this brand's stops the creation — the
post is never made without it.

The two media failures of `create_post` mean opposite things. `media_not_found` (400) is yours:
the id is not this brand's, so check it against `brand_media`. `media_unavailable` (502) is ours:
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

`generate_image` and `generate_video` make a NEW image or clip and put it straight into the brand
library — no post, nothing in the calendar. **They spend credits**, unlike `import_media_url`:
every image is a paid render and every clip a paid render. `count` draws up to 4 alternatives in
one call and bills each one, so generate a few, look at them with a `query` on `brand_media`, and
pass only the id you keep to `create_post` as `media_ids` — the calendar stays clean either way.

An image comes back finished: `media` carries the rows, each with a `signed_url` you can open. A
video cannot: it takes minutes, longer than any single call may last, so it comes back with
`status` `rendering` and a `job_id`, and a `query` on `video_renders` says where it got to. Do not
call `generate_video` again for the same clip while one is rendering — that bills a second one.
Refusals: `credits_exhausted` (402) means the brand's pool is empty and
nothing was drawn; `video_budget_exhausted` (400) means the monthly video allowance is used up,
counting the clips still rendering; `render_failed` (502) is the model returning nothing, and
nothing is stored; `store_failed` (502) means it was drawn but could not be filed.

`generate_captions` writes captions and nothing else — text, no image, no video, and **no post**:
it creates nothing in the calendar, so the caption you keep still has to go to `create_post` as
`caption` (or inside `platform_captions`) to exist anywhere. Required: `slug`, `topic`; optional
`platforms` and `format`. **This spends credits** — one model turn per call.

Called with `topic` alone it writes for every platform at once, each caption composed for the
platform it is going to and already inside that platform's character limit, rather than one text
trimmed nine different ways. Name `platforms` and you get only those, written to their own limits
with no further shortening — asking for X alone costs one caption, not nine with eight thrown
away. Every entry comes back with `parts`, the platform's `limit`, and `publishable`.

The response carries `cost_usd`: what the gateway billed for that call, the same figure written
to the usage ledger, not a price list rewritten here. `null` means no invoice came back — that is
**unknown, not free** — so reconcile against the ledger rather than reading a missing number as
zero.

`format` defaults to `single`: one post per platform, guaranteed to fit. `format: "thread"` lets
X and Threads run as long as the idea needs and returns `parts` as a numbered sequence — each
part whole words only, never a URL or a mention cut in two, with the `1/4` counted inside the
limit. Such a sequence comes back with `publishable: false`, and it means it: publishing sends
one post per platform, so a sequence is for pasting by hand, not for `create_post`. Refusals:
`credits_exhausted` (402) means the pool is empty and nothing was written; `no_captions` (502) is
the model returning nothing.

`generate_image` draws a picture from a description — "an image of a cat", a product shot, a
background for a slide. Required: `prompt`. Optional: `slug`, `count` (1-4 alternatives, **each
one billed**), `aspect_ratio`, `model`, `brand_style`, `title`. With a slug, that brand's own look
is applied by default — its colours, its fonts and the visual direction it has settled on — so you
do not have to describe them. Without a slug there is no brand and none of that reaches the model,
so name the style you want in the prompt.

**`brand_style` turns that default off, and only a slug gives it a meaning.** Leave it out and the
brand's look is applied, which with a slug is almost always what you want. Send `ignore` when the
picture must take nothing from the brand: a plain UI screenshot, an illustration about somebody
else, a neutral background — places where brand colours and fonts spoil the result. Without a slug
there is no brand to apply or ignore, and sending it is refused as `brand_style_needs_a_brand`
rather than quietly dropped: pass a slug, or drop `brand_style`. `refine_media` takes the same
field, and the brand's look reaches a refinement the same way. `generate_carousel` applies
it too but takes no `brand_style`: a series that is not the brand's is not a series — call
`generate_image` when you need the switch. A
clip filmed by `generate_video` from a prompt alone follows the brand's visual direction and cannot
be switched off either; animating a library image takes its look from that image's pixels instead.

**`slug` is optional, and which way you call it is the only choice to make.** WITHOUT it this is a
one-off drawing: no brand, nothing filed anywhere, `id` comes back `null` and there is nothing to
hand to `create_post` — you get a `storage_path` and a signed `url` that expires in two hours, so
save what you want to keep. WITH it the image lands in that brand's library, a `query` on
`brand_media` finds it again, and its `id` is what `create_post` takes as `media_ids`: that is the path for anything that
belongs to a brand or is going to become a post.

**Do NOT call `list_brands` to decide where to draw.** If nobody named a brand there is no brand.
Guessing one spends a real organisation's credits and litters a real library — call it without
`slug` instead. Without `slug` the credits come from your organisation, and the response names it
in `organization` so the bill is never anonymous.

It creates nothing in the calendar and publishes nothing, so ask for two or three, look at them,
keep one. The response carries three facts worth reading. `model` is the model that **actually**
drew it, after the brand's choice and the platform default — read it rather than assuming your
request won, because an environment override can still outrank it. `renders` is how many renders
were **billed**, which can exceed the images you got back: a render that succeeds and is then
discarded downstream is paid for all the same, so trust `renders` over your own count when
reconciling spend. `cost_usd` is what those renders actually cost, read off the invoice — `null`
when no invoice came back, never `0`.

**One prompt, one render, no safety net.** Nothing inspects the image after the model draws it:
there is no quality control, no critic that rejects a bad frame, no retry you did not ask for.
What comes back is what was billed, however crooked. Judging it is YOUR job — open the
`signed_url`, look, and if it is wrong send it to `refine_media` rather than prompting again.

`refine_media` changes something that is already in the library — an image or a video — and files
the result as a **new** asset, so the original is never overwritten and a refinement cannot destroy
what it started from. Required: `slug`, `base_media_id` (from `brand_media`, and it must belong to
this brand — anything else is `source_not_found`), `instruction`. Say what should CHANGE, not what
the whole thing should be.

**You do not say what kind it is.** The asset's own kind, read from the library row, picks the
engine: a picture goes to the image refiner, a clip to the video one, and the answer says which in
`kind`. Logos and illustrations are images in the library, so they take the image path; the
programmatic motion graphics (`motion_write`) are not generative renders and are not refined here.

Each kind has its own model slot — `imageRefineModel` for a picture, `videoRefineModel` for a clip —
and both are read from `get_media_models`. A brand that has never chosen a video refine model gets
`no_refine_model` (400) on a clip rather than a newly filmed one: refusing is the point, because
filming a new clip for someone who asked to correct theirs is the exact mistake this tool ends.
`kind_not_refinable` (400) means the asset is neither. `count` draws alternatives for a picture; a
clip always comes back as one.

`source_too_large` (413) is not `source_not_found`: the asset is there, it is just heavier than a
model can be handed, and the answer carries its `bytes` and the `limit`. An oversized source is
shrunk before the model sees it, so this only reaches you for a file beyond even that — import a
lighter copy. **Never answer it by generating a replacement**: the original is still the customer's
and a fresh render is a different picture.

`generate_video` films a NEW clip into the library. Required: `slug`, `prompt`; optional
`base_media_id`, `duration`, `aspect_ratio`, `model`, `title`. **`base_media_id` pointing at a
library IMAGE is how you animate a photo** — the image becomes the clip's first frame, so subject,
scene and style come from those pixels and the prompt directs the movement only. Without it the clip
is filmed from the prompt alone. It creates nothing in the calendar; when the clip lands, pass its
`media_id` to `create_post`.

A clip takes minutes, so this returns `status: rendering` and a `job_id`, and a `query` on
`video_renders` says when it is done — do not call it again for the same clip while one is
rendering, that bills a second.
Animating and filming are two different jobs with two different model lists (`videoImageModel` and
`videoModel`): a model valid for one is refused for the other with `model_not_for_slot` and the
accepted list. Refusals: `source_not_found` (404) means the id is not this brand's or does not
resolve to one asset; `source_not_an_image` (400) means it exists but is a video;
`video_budget_exhausted` (400) counts the clips still rendering, not just the ones that landed;
`duration_out_of_range` (400) means the model cannot film the seconds you asked for and the message
names the nearest it accepts. A refusal from the provider comes back as `render_failed` **with a
`reason`** saying what it objected to — read it before retrying, because retrying the same request
buys the same refusal. The success response carries `duration_seconds`, the seconds actually
submitted: a clip is billed per second, so read it rather than assuming your number was taken.

`generate_carousel` draws a SERIES that reads as one object. Required: `slug`, `brief`; optional
`slides` (3-8), `aspect_ratio`, `model`, `title`. **It bills a render per slide** — five slides is
five renders — and files them in order, slide 1 first. Pass the ids to `create_post` as `media_ids`
in that order.

The response carries `continuity_tokens`: the 2-3 literal tokens — palette words, a recurring motif,
a lighting phrase — repeated verbatim in every slide prompt. They are what makes it a series rather
than N unrelated pictures. **To change one slide, use `refine_media` on that slide's id and put those
tokens back into the instruction**; an edit touching palette, light or the motif without them takes
that slide out of the set, and nothing warns you. There is no separate slide tool: `refine_media`
edits the pixels you already have, which holds continuity better than re-prompting from scratch.

**Choosing the model.** Every generator takes an optional `model` that applies to **that call
only** and changes no brand setting — that is the difference from `set_media_model`, which is "from
now on". The ids each job accepts come from `get_media_models`, which also names the job each slot
does; anything else is refused as `model_not_for_slot`, and the refusal carries `allowed`, the list
that would have been taken. The choice moves the bill: a light image model and a heavy video model
are two orders of magnitude apart, so read the list before spending.

Those jobs are read back with `query` on `video_renders` — `id`, `status`, `error`,
`submitted_at`, newest first — and then `brand_media` filtered on `source_ref` with that id, whose
row is what `create_post` takes as `media_ids`. A `done` render with no media row never reached
the library. The read calls no model and spends no credits, so poll it rather than guessing.

`create_post` stores copy **you** wrote: Anomalia calls no model and spends no credits. It does
not publish and does not schedule — `scheduled_for` is the proposed calendar time and stays a
proposal until `approve_post`, which is what authorizes distribution. Text-capable platforms
only (`facebook`, `linkedin`, `x`, `threads`, `bluesky`, `reddit`) unless you pass `media_ids`;
`instagram` and `tiktok` need an image, `youtube` a video. Required: `slug`, `platforms`, `caption`. Optional:
`platform_captions`, `scheduled_for` (ISO — no offset means the brand's timezone), `title`
(required for Reddit), `subreddit`, `link_url`. The result carries the post id, its
`pending_user` status, the stored instant and a `review_url` the operator can open.

`edit_post` changes what a post SAYS. Two of its fields look like "when" and only one is: `slot`
is the calendar day the post sits on, while `scheduled_for` — the instant it actually goes out —
is not editable here at all. Moving a post in time is `reschedule_post`, and nothing else.

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

A `query` on `shared_views` — `id`, `view_type`, `created_at`, `expires_at`, `revoked_at` — shows
what exists, and no token is in it. `revoke_share` turns one off by `id`: from then on it answers
exactly like a link that never existed, and brand membership is untouched.

Both writes need the `shared_views` table. Until it is migrated they answer
`shares_not_migrated` and name the file to apply.

## Plans

| MCP | CLI |
|-----|-----|
| `propose_plan` / `revise_plan` / `approve_plan` / `discard_plan` | `anomalia plan <slug> propose\|revise\|approve\|discard` |
| `save_brief` / `replan_week` | `anomalia plan <slug> save-brief\|replan --week N …` |
| `plan_week` / `produce_week` | `anomalia weekly-plan <slug> plan\|produce --week N` |
| `save_plan` | (MCP only) |
| `save_week_seeds` | (MCP only) |

Reading the plan back is `query` on `editorial_plans` — `strategy`, `voice`, `cadence`,
`platform_mix` and `weeks`, filtered `status` `eq` `active` — or `anomalia plan <slug>` and
`anomalia weekly-plan <slug>`, which both still answer.

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
| `save_memory` | (MCP only) |
| `record_memory_used` | (MCP only) |

What the brand already knows lives in `brand_memory` and is read with `query`, so you stop asking
the operator things it has already answered: its voice, the constraints it works under, the facts
it confirmed, the preferences it stated, what previous work learned.

```
query({ table: "brand_memory",
        columns: ["id","key","value","category","confidence"],
        where: [{column:"layer",op:"neq",value:"session"},
                {column:"agent",op:"is",value:null}],
        order: {column:"confidence",ascending:false} })
```

Those two filters are the ones `get_memory` used to impose before it was retired: no chat-session
notes, no other agent's working notes. Drop them and both come back. `category` narrows with one
more `eq` clause. A brand with more memory than one page holds is read by `category`, or by
walking `offset` — the reply names the one that resumes.

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
| `update_brand_identity` | `anomalia studio <slug> kit-update\|colors …`, `anomalia voice <slug>` |
| `add_note` / `delete_document` | `anomalia studio <slug> add-note\|delete-doc …` |
| `add_person` / `generate_person` / `delete_person` | `anomalia studio <slug> people-*` |
| `add_competitor` / `delete_competitor` / `research_competitors` | `anomalia studio <slug> add-competitor\|…\|research` |
| `delete_product` | (MCP only) |
| `set_bio` | (MCP only) |
| `sync_history` | `anomalia studio <slug> sync-history` |

What the studio holds is read with `query`, one table at a time: `products`, `people`,
`competitors` and `brand_kit`, each row with its id. `anomalia studio <slug>` still prints the
same thing in one command. To answer a question from the brand's documents, do not read them —
call `search_knowledge`, which returns the passages that answer it with the document each came
from.

An offer, a person's role, a competitor's website are rows: `insert_row({ table: "products",
values })` adds one, `update_row({ table, where: [{ column: "id", op: "eq", value }], values })`
corrects one. Only the columns you send are touched. The e-commerce resync behind `sync_products`
replaces the whole catalog and would erase a hand-made row.

**A bare host is refused now, not corrected.** `competitors.website` is checked by
`competitors_website_check` (`website ~ '^https?://'`) and `products.url` by `products_url_check`:
`example.com` comes back as a refusal naming the constraint, where the retired `update_competitor`
turned it into `https://example.com` without saying so. Send the scheme.

**Consent for a real person is the operator's act, not yours.** Never write `consent`,
`consent_at` or `consent_source` on `people`: a real person's face stays withheld from every
generator until the operator states it in their own words. The deletes want the UUID in full,
verbatim from the `query` that listed the row.

`set_bio` records the link in bio; no publishing API writes a profile bio, so a person still
pastes it on the profile by hand. What is recorded now is `bio_url` on `social_accounts`, read
with `query`.

## Knowledge

| MCP | CLI |
|-----|-----|
| `search_knowledge` | (MCP only) |

`search_knowledge` asks the brand's OWN documents a question and returns the passages that answer
it — not a list of files. Every hit carries where it came from (`documentId`, `title`,
`headingPath`, `chunkId`), so a claim can be attributed instead of asserted. Retrieval is hybrid
over what is already indexed: keywords first, one embedding of the question only when keywords
come up short. No credits, no writes.

Passages are cut at 1500 characters and `truncated` says when there is more; `limit` is 6 by
default and 20 at most, so ask a narrow question several times rather than a wide one once.
`collection` narrows to a shelf: `brand`, `product`, `commercial`, `legal`, `operations`,
`research`.

Empty `hits` is not the same as "the brand does not know this": count what is indexed before
concluding anything.

```
query({ table: "brand_doc_chunks",
        columns: ["id"],
        where: [{column:"embedding",op:"is",value:null,negate:true}],
        count: "exact", limit: 1 })
```

`total` is the only number retrieval can see: a document that is stored but has no embedded chunk
is not searchable, however ready it looks. A `total` of 0 means nothing is searchable yet.

So: empty `hits` with chunks embedded → the brand does not know it, go add a document. Empty with
`total` at 0 → it may already know it and nobody has indexed the file yet. Two opposite
situations, two opposite actions.

## Brand settings

| MCP | CLI |
|-----|-----|
| `set_brand_settings` | (MCP only) |

How the brand works: posting `timezone`, target `platforms`, `hashtags` per platform, and
`voice_examples` (real past posts the AI imitates for tone). They are read with `query` on
`brands` — `timezone`, `target_platforms`, `content_prefs`, with `limit: 1` — where hashtags and
voice examples live inside that jsonb column. `set_brand_settings` changes only the
fields you send; `hashtags` and `voice_examples` **replace** the whole list, so send the full list,
not a delta — `{}` and `[]` clear one.

Two consequences to say out loud before you change either of the first two:

- **Timezone.** A post that already has a time does not move. It keeps firing at the same absolute
  instant, so its local hour shifts by the offset difference — 18:00 in Rome reads as 12:00 once
  the brand moves to New York. Only new scheduling uses the new zone.
- **Platforms.** The target list decides what NEW posts are made for, never what publishes.
  Removing a platform does not cancel posts already scheduled on it: they still go out while their
  account is connected.

The write answers with `without_account`. Targeting a platform with no connected account is
allowed and silent otherwise: posts for it are produced and then sit unpublished until an account
exists. Say so when it happens, and read `social_accounts` with `query` — `platform`, `username`,
`status` — which is where *why* a platform is missing becomes visible.

An unknown IANA zone is refused (`unknown_timezone`), and so is a platform outside the list —
`twitter` is not a name here, it is `x`. The post language lives on `update_brand_identity`, not here.

## Recurring jobs

| MCP | CLI |
|-----|-----|
| `set_automation` | (MCP only) |

The nine jobs included with the product — `autopilot`, `analytics_review`, `weekly_recap`, `seo`,
`geo`, `radar_recap`, `market_refs`, `strategy_review`, `library` — are named in
`set_automation`'s own schema. What each has been doing is `query` on `loop_ticks`, filtered on
`loop` and `created_at`, which is how often it actually ran and how it went; `brand_job_optouts`
says which are off. A tick a gate stopped spent nothing.

**Turning one ON is a spending decision, not a preference.** From that moment the job runs by
itself on its cadence, and every run calls AI models and spends the brand's credits, with nobody
looking. Before you turn one on, say which job it is, how often it will run, and that it spends —
to the person whose credits they are. Turning one OFF spends nothing, takes effect at the next
tick, and destroys nothing: it is the safe direction, so do not make it hard.

There is **no** cost per job anywhere, and that is not an omission to work around: AI spend is
logged per call with no column naming the job, and the same labels are shared between jobs, so any
per-job figure would be invented. Describe the commitment with the cadence and how many times it
ran, and point at the usage page for the brand-wide bill.

A brand without a paid plan runs none of them however many are on. The calls themselves spend no
credits.

## Radar sources

| MCP | CLI |
|-----|-----|
| `set_radar_platform` | (MCP only) |
| `add_radar_source` | (MCP only) |
| `remove_radar_source` | (MCP only) |

Where Radar looks: which platforms are on (`gnews`, `reddit`, `threads`, `x`, `linkedin`) and
which sources are configured (`gnews_query`, `rss`, `subreddit`, `reddit_query`, plus
`threads_query`, `x_community`, `linkedin_query`).

**Read the state first.** `query` on `brand_news_sources` — `id`, `kind`, `value`, `lang`,
`active` — is what is configured, and `brands.content_prefs.radar` is which platforms are on. The
two things you cannot read that way are the plan's: Threads, X and LinkedIn belong to the **Pro**
plan, and below it both writes answer `plan_required` (403). Past the ceiling on how many sources
a plan allows, `add_radar_source` answers `source_limit` (403) and names it.

A source is identified by the pair **(kind, value)** — there is no id to remember, and it is what
`remove_radar_source` takes. Adding one that is already there is not an error: nothing changes and
`added: false` says so. `rss` must be an http(s) URL; a subreddit is stored without its `r/`, and
both writes normalise it the same way, so `r/coffee` and `coffee` are the same source.

Adding a source spends no credits by itself, but Radar reads it on every run from then on.
Removing one is permanent and stops Radar reading it; what it already found stays.

## Blog settings

| MCP | CLI |
|-----|-----|
| `set_blog_settings` | (MCP only) |
| `add_blog_term` | (MCP only) |
| `remove_blog_term` | (MCP only) |

How the blog looks (name, colour, font, layout, nav links, whether it is live) and how it writes
(style brief, articles per week, languages, humanising pass), plus the categories, tags and
authors an article can be filed under.

**Read the state first.** `query` on `brands` for `blog_config` is how it looks and how it writes;
`blog_categories`, `blog_tags` and `blog_authors` are the three lists. The accepted fonts, layouts
and locales — and the plan's ceiling on articles per week, extra languages and a custom domain —
are carried by `set_blog_settings`'s own schema and by what it answers, not by a table.

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
| `update_brand_identity` | (MCP only) |

The look every render follows: logo, favicon, colour palette, the two Google Fonts graphics are
composed with, and the visual brief. It is one row of `brand_kit`, so it is read with `query`:

```
query({ table: "brand_kit",
        columns: ["logos","favicon_url","brand_colors","graphic_style",
                  "visual_style","visual_style_locked"] })
```

The brand's logo is the entry in `logos` whose `type` is **not** `og-image` — that one is the
picture we guessed off the site, not the one anybody chose.

**Read it before writing** — a font the row does not carry is a font Google Fonts will not serve,
and the graphics would silently come out in Inter.

`logo_url` and `favicon_url` are **downloaded and re-hosted**, not linked: the answer carries the
address we stored, which is the one every graphic will use. A private, redirecting or oversized
address is refused (`image_rejected`) rather than half-saved, and `remove_logo` clears the logo —
the two cannot be combined (`logo_conflict`). `display_font` and `body_font` go together
(`font_pair_incomplete`) and are checked against Google Fonts before saving (`font_not_available`,
which names the missing family). Setting `visual_style` **locks** it: the nightly rebuild stops
rewriting the brand's visual brief until someone regenerates it from the browser.

The colours live on the same tool: `colors`, three or six hex digits, up to 8, and the list
REPLACES the palette. `update_brand_identity` took the place of `set_appearance`, `set_colors`,
`update_brand_kit` and `update_voice` — the four wrote the same two rows, and the split is why
"change the brand's colours" opened the tool called appearance and found no colour field.

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
| `seo_action` | `anomalia seo <slug> [run\|plan\|…]` |
| `geo_action` | `anomalia geo <slug> [run\|fix]` |
| `refresh_keywords` | `anomalia keywords <slug> [refresh]` |
| `get_gsc` | (MCP only) |
| `generate_article` / `optimize_article` | `anomalia web <slug> …` |
| `update_article` | (MCP only) |
| `publish_article` / `unpublish_article` / `delete_article` | `anomalia web <slug> publish\|…` |
| `get_ads` / `ads_action` | `anomalia ads <slug> [--propose\|--create\|--approve\|--pause\|--resume\|--duplicate\|--delete\|--reject] [--ad <adId>]` |
| `ads_remix` | (MCP only) |
| `diagnose_radar` | (MCP only) |

What the brand's FIELD is doing — not what the brand is doing — is
`GET /api/v1/brands/:slug/market/field`: the topics being watched, the playbook distilled from
them, and the catalogued posts each with a teardown (tone, format, hook, what made it spread,
what is transferable, what to avoid). A field never watched answers with `topics`, `playbook` and
`updatedAt` at `null`: that is a state, not an error, and it means the weekly pass has not run
for this brand yet.

`diagnose_radar` answers "why does Radar find nothing". It fetches every configured source live
and reports, per source, how many items came back — or `skipped` (source off, plan, platform
toggle) or `error` (the endpoint failed). It spends no credits and writes nothing, but it does
leave the building: one network request per source, so it can take seconds. Dynamic keyword
searches are not probed here.

The brand's idea bank — the disruptive ideas agents saved while working — is the
`disruptive_ideas` table, read with `query`:

```
query({ table: "disruptive_ideas",
        columns: ["id","title","idea","device","why_it_contrasts","who_it_annoys","score","status"],
        where: [{column:"status",op:"in",value:["new","shortlisted"]}],
        order: {column:"score",ascending:false} })
```

That `where` is the default the retired `list_ideas` applied: only the ideas still usable. Drop it,
or filter on `used` / `archived`, for the rest. Each idea carries the contrast `device` it uses,
`why_it_contrasts` and `who_it_annoys` — an idea that annoys nobody is not one. `query` sorts on
one column, so ideas with the same score come back in whatever order the planner picks; the old
tool broke that tie by newest.

The list of articles is the same move — `query({ table: "brand_articles", columns: ["id","slug",
"title","status","scheduled_for","published_at","created_at"] })`. Name those columns: without
them the read drags `body_md` in and the character cap returns one article instead of twenty.

`seo_action` and `geo_action` are the paid half: they run a new audit or write the fixes. Reading
what a past audit already measured costs nothing and never needs a new one — that is the two
queries below.

`get_gsc` is the measured side of the same brand: Google Search Console over the last 28 days —
clicks, impressions, top queries and top pages — and it says whether the property is connected at
all, since `connected: false` means there is nothing to read yet, not that the brand ranks
nowhere. No model, no credits, no writes.

Rank tracking is a `query`: `brand_tracked_keywords` (`id`, `keyword`, `locale`, `device`,
`active`) for what is watched, then `brand_rank_snapshots` filtered on `tracked_keyword_id` for
where each one sits and where it sat. The backlinks network stayed on its endpoint,
`GET /api/v1/brands/:slug/backlinks`: links given and received plus the open opportunities, and
whether the network is usable at all — it needs Starter or above **and** the brand's opt-in.

`ads_remix` is the opposite: it **spends credits**. It harvests the competitor and trending ads
already collected for the brand, looks at them with vision, and returns ranked remix briefs in the
brand's voice — `rank`, `strategy`, `keep`, `change`, `hook`, `headline`, `body`, `cta`,
`productName`, `visualPrompt`. It takes `slug` and nothing else, and it **replaces** the briefs
that were there, so run it when you mean to redo them. Refusals: `no_competitor_ads` (400, nothing
harvested yet — there is nothing to remix), `no_remix_briefs` (400, the pass produced none),
`ads_not_on_plan` (403) and `credits_exhausted` (402). Launching an ad is still `ads_action`; this
only writes the briefs.

Tracing an audit back to what was actually measured is two tables:

```
query({ table: "brand_geo_audits",
        columns: ["id","created_at","tech_score","tech","share_of_voice","citations"],
        order: [{column:"created_at",ascending:false}], limit: 12 })

query({ table: "brand_geo_artifacts",
        columns: ["id","kind","title","format","body","status","target_path","source_finding"],
        where: [{column:"status",op:"eq",value:"draft"}] })
```

`tech` holds what the crawl observed, and `citations` the probes behind the share of voice —
engine, question asked, verdict, domains cited — which is how a claim is attributed instead of
asserted. `brand_geo_artifacts.body` is the fix itself, `kind` and `target_path` say what it is
and where it goes. Both reads are free: never run a new audit to see what a past one measured.
Bodies are long, so read a fix with `limit: 1` when you need it whole.

To read ONE article in full — draft, planned, approved or published — is a `query` on
`brand_articles` with `limit: 1`, which is the case where long text is not truncated: `body_md`,
`meta_title`, `meta_description`, `status`, `language`, plus `embed` on `blog_categories` and
`blog_authors` for its filing. Read it before editing and again after.

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
| `create_social_connect_link` | (MCP only) |

Where the brand actually publishes, and how a platform gets connected. This is **not**
`connections` / `list_integrations_tools`: those are Composio (Drive, Notion, GitHub, Gmail).
This is the social accounts a post goes out on.

`query` on `social_accounts` — `platform`, `username`, `display_name`, `profile_url`, `status`,
`connected_at`, `bio_url` — returns one row per account. A post leaves only from an **active**
one, so a platform whose rows are all expired, revoked or disconnected is usually the answer to
"why hasn't this published?": the post is scheduled, the platform is targeted, and the account
stopped working weeks ago. `status` is where that shows, and nowhere else does.

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
