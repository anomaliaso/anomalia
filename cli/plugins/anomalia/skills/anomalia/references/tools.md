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
