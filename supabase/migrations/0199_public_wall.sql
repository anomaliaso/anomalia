-- 0199: the public wall — /trending and /design, the two pages the radar finally shows to strangers.
--
-- Everything `market_*` was built as an internal instrument: 0181 says as much in its header
-- ("nothing here is user-facing and nothing is published"), and that stays true of the TABLE. What
-- changes here is that a narrow, explicitly-flagged SLICE of it becomes readable to the public, and
-- the columns below are the flags that decide which rows those are. No RLS policy is added: the
-- public pages read through the service role and hand out a whitelisted projection (`wall.ts`), so
-- a column added to `market_posts` next month cannot leak by accident.
--
-- THREE FACTS ARE KEPT APART ON PURPOSE, because collapsing them is how a gallery ends up publishing
-- something it never judged:
--
--   design_*      what the judge thought of the piece AS DESIGN. Independent of how it performed.
--   poster/preview  whether we hold a PUBLISHABLE copy of the media. A row can be brilliant and
--                 unshowable — the CDN link rotted before the archive ran.
--   wall_state    the human override. 'auto' is the default and means "the rules decide".
--                 'hidden' is the takedown switch and beats every score. 'forced' pins a row in.
--
-- A row reaches a public page only when all three agree. That is also why the design score does not
-- live in `quality_index`: that column scores TEXT with the same rubric we grade our own captions
-- with, and overloading it would silently change what every existing fit means.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

-- ── The judgement ────────────────────────────────────────────────────────────────────────────────

alter table public.market_posts
  -- Is this a DESIGNED piece at all? The corpus is mostly filmed UGC, and a phone video of a plate
  -- of pasta has no typography to grade. False here is the honest answer for most of the bank, and
  -- it is what keeps the design wall from filling up with 6/10 snapshots that outscored nothing.
  add column if not exists is_design boolean,
  -- 0–100, the judge's overall. Deliberately a wider scale than the 1–10 sub-scores: the wall ranks
  -- on this, and ties on a 10-point scale are constant.
  add column if not exists design_score numeric,
  -- The sub-scores it was built from: typography, composition, colour, craft, originality (1–10).
  -- Kept because "why is this on the wall" must be answerable, and an overall alone never answers it.
  add column if not exists design_scores jsonb,
  -- Fixed vocabulary (see DESIGN_TAGS in design-judge.ts) — fixed because these are the filters the
  -- public page groups on, and a free-form label produces one bucket per post.
  add column if not exists design_tags text[],
  -- One sentence about what the piece does well, keyed by locale: {"en": "...", "it": "..."}. This is
  -- the only model-written text that reaches a public page, so it is STORED rather than regenerated —
  -- the page must render the same words tomorrow, and a re-roll per request would be slower, costlier
  -- and less true. All four site locales come back from the SAME call: a one-sentence translation is
  -- free next to the image tokens, and generating them later would mean re-showing the model a picture
  -- it has already been paid to look at.
  add column if not exists design_note jsonb,
  -- The auto-publish gate. Curation here is fully automatic, so "is this something we are willing to
  -- put on our own front page" has to be a judged field and not an afterthought: nudity, gore, hate,
  -- a private individual's data, partisan political content and anything that is plainly an ad for a
  -- scam all come back false, with the reason in `design_block_reason`.
  add column if not exists design_publishable boolean,
  add column if not exists design_block_reason text,
  add column if not exists design_scored_at timestamptz,
  -- Bump the rubric version in code and every row becomes re-judgeable without a backfill script.
  add column if not exists design_scorer_version int;

-- ── The publishable copy ─────────────────────────────────────────────────────────────────────────
--
-- `media_path` (0183) is our archive: a PRIVATE bucket, signed on read, 8MB stills and 64MB clips.
-- None of that can be served from a public page — a signed URL expires (so it cannot be CDN-cached,
-- and a crawler that stores it gets a 400 later), and a 64MB source clip is not a grid thumbnail.
--
-- So the wall keeps its own derivatives, in a PUBLIC bucket, built once by a worker and then served
-- as immutable static files. The request path does no work at all: no signing, no transcoding, no
-- database read for the bytes.

alter table public.market_posts
  -- Still, WebP, long edge 1080. Every card shows this.
  add column if not exists poster_path text,
  -- The moving one: animated WebP, ~360px, a few seconds, no audio. This is the "gif" — WebP rather
  -- than GIF because it is a quarter of the bytes at the same size, and an <img> rather than a
  -- <video> because an <img> has no autoplay policy to lose and no media element per card.
  -- Null for stills, which is not a failure: `preview_state` says which of the two it is.
  add column if not exists preview_path text,
  add column if not exists preview_bytes bigint,
  add column if not exists poster_bytes bigint,
  -- 'ready' both derivatives exist · 'still' the source was an image, so there is nothing to animate
  -- · 'failed' we tried and could not · null not attempted yet. A failed row keeps its reason so a
  -- dead ffmpeg and a rotted source link never look alike from the outside.
  add column if not exists preview_state text
    check (preview_state is null or preview_state in ('ready', 'still', 'failed')),
  add column if not exists preview_error text,
  add column if not exists preview_built_at timestamptz;

-- ── The override, and the public identity ────────────────────────────────────────────────────────

alter table public.market_posts
  -- 'auto'   the rules decide (default).
  -- 'hidden' never public, whatever it scored. The takedown switch: a creator asking to be removed
  --          must be one UPDATE away, not a code change.
  -- 'forced' public regardless of score. For a piece the rubric underrates.
  add column if not exists wall_state text not null default 'auto'
    check (wall_state in ('auto', 'hidden', 'forced')),
  -- Stable, human-readable URL for the detail page. Assigned once at publish time and never
  -- recomputed: a slug that follows an edited caption is a broken link with extra steps.
  add column if not exists wall_slug text,
  add column if not exists wall_published_at timestamptz;

create unique index if not exists market_posts_wall_slug_idx
  on public.market_posts (wall_slug)
  where wall_slug is not null;

-- ── Work queues and read paths ───────────────────────────────────────────────────────────────────

-- The judge's queue: a POSTER exists and the rubric has not seen it. The poster, not `media_path`,
-- is the gate — the judge looks at the picture, and looking at the derivative instead of the source
-- means one 80KB WebP per call rather than one 64MB clip, on the same frame the public will see.
-- A row with no permanent copy therefore never enters this queue at all, instead of sitting in it
-- forever pretending it could be judged.
create index if not exists market_posts_design_queue_idx
  on public.market_posts (discovered_at desc)
  where poster_path is not null and design_scored_at is null;

-- The derivative builder's queue: anything the wall could show that has no public copy yet.
create index if not exists market_posts_preview_queue_idx
  on public.market_posts (discovered_at desc)
  where media_path is not null and preview_state is null;

-- The design wall's read path.
create index if not exists market_posts_wall_design_idx
  on public.market_posts (design_score desc)
  where is_design and poster_path is not null and wall_state <> 'hidden';

-- The trending wall's read path — ordered by recency, filtered on having something to show.
create index if not exists market_posts_wall_trending_idx
  on public.market_posts (published_at desc)
  where poster_path is not null and wall_state <> 'hidden';

-- ── The public bucket ────────────────────────────────────────────────────────────────────────────
--
-- Separate from `brand-knowledge` (private, per-brand, 0021) and from `media` (0004, the brands' own
-- published assets). A third bucket rather than a prefix in either, because "public" is a property of
-- the BUCKET in Supabase storage: putting wall derivatives under a prefix of a private bucket would
-- mean signing every card, and under a prefix of `media` would mean one bad path traversal exposes a
-- customer's assets. Mime types are pinned to what the builder can emit — WebP for both
-- derivatives, GIF only as the fallback for an ffmpeg build without libwebp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wall', 'wall', true, 12582912, array['image/webp', 'image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
