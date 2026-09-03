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
| `create_post` | (MCP only) |
| `list_media` | (MCP only) |
| `check_content` | (MCP only) |
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

`list_media` lists what is already in the brand library; an id from there goes into `create_post`
as `media_ids` and costs no render. A media id that is not this brand's stops the creation —
the post is never made without it.

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
| `get_keywords` / `refresh_keywords` | `anomalia keywords <slug> [refresh]` |
| `list_articles` / `generate_article` / `optimize_article` | `anomalia web <slug> …` |
| `publish_article` / `unpublish_article` / `delete_article` | `anomalia web <slug> publish\|…` |
| `get_ads` / `ads_action` | `anomalia ads <slug> [--propose\|--create\|--approve\|--pause\|--resume\|--duplicate\|--delete\|--reject] [--ad <adId>]` |
| `chat` | `anomalia ai <slug> --message "…" --pipe` |
