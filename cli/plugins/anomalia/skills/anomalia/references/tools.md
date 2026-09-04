# Anomalia MCP tools ↔ CLI

All tools take a brand `slug` when brand-scoped. Ids accept short unambiguous prefixes.

## Auth

| MCP | CLI |
|-----|-----|
| `login` | `anomalia login` |
| `logout` | `anomalia logout` |
| `whoami` | (session file / brands imply identity) |
| `list_brands` | `anomalia brands` |

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

It never looks at pixels — judging an image or a video is a separate, explicitly paid action.

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

`create_product` adds ONE offer. The e-commerce resync behind `sync_products` replaces the whole
catalog and would erase a hand-made row.

`update_product`, `update_person` and `update_competitor` take the row `id` verbatim from
`get_studio` or `list_products` — no short prefixes here. They change only the fields you send:
every other column keeps the value it had. An id from another brand answers `not_found`, exactly
like one that does not exist anywhere.

`update_person` cannot attest consent, turn a real person into an AI persona, or touch photos. A
real person's face stays withheld from every generator until the operator states the consent in
their own words.

`set_bio` records the link in bio; no publishing API writes a profile bio, so a person still
pastes it on the profile by hand. `get_bio` also returns the short link worth putting there — the
one with the most clicks in the last seven days.

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
posts for it are produced and then sit unpublished until an account exists. Say so when it happens.

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
