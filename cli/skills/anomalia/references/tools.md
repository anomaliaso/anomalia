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
- **template** — ONE structure chosen for your format, platform and goal, its hook family, and the
  playbook for exactly the platforms you asked about.
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
| `add_competitor` / `delete_competitor` / `research_competitors` | `anomalia studio <slug> add-competitor\|…\|research` |
| `sync_history` | `anomalia studio <slug> sync-history` |

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
| `list_articles` / `generate_article` / `optimize_article` | `anomalia web <slug> …` |
| `get_article` / `update_article` | (MCP only) |
| `publish_article` / `unpublish_article` / `delete_article` | `anomalia web <slug> publish\|…` |
| `get_ads` / `ads_action` | `anomalia ads <slug> [--propose\|--create\|--approve\|--pause\|--resume\|--duplicate\|--delete\|--reject] [--ad <adId>]` |
| `chat` | `anomalia ai <slug> --message "…" --pipe` |

`get_seo` and `get_geo` answer on the **latest** audit. The four web tools let you trace a claim
back to what was actually measured, without paying for a new audit. All four are reads: they call
no model, spend no credits and write nothing.

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
