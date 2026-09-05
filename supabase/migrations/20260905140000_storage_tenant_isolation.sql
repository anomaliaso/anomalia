-- Storage, closed to the tenant it belongs to — and the dashboard drift that opened it.
--
-- A red team, with a self-registered account, wrote a 20 MB file INTO ANOTHER USER'S FOLDER on the
-- `media` bucket, and served an SVG carrying a <script> back from a public URL. Neither the policy
-- that allowed it nor the bucket that stored the second one is in any migration: both were made by
-- hand in the dashboard, so `npm run db:migrate` on a fresh database has never produced the schema
-- production actually runs.
--
--   `Allow authenticated uploads to media bucket`  INSERT · authenticated · with check
--   (bucket_id = 'media') — no folder condition at all. Permissive policies are OR'd, so this one
--   made `media insert own folder` (0004) decorative: it could only ever add access, never remove
--   it. The narrow policy was there the whole time and defended nothing.
--
-- Everything below is written to converge BOTH databases: it drops what the dashboard added and
-- creates what the dashboard created, so a fresh self-host ends where production ends.

-- ── media: one policy, both legitimate prefixes ──────────────────────────────────────────────────
--
-- Two shapes are real, and each is proved twice — by the objects in production and by the code:
--
--   `${userId}/…`   uploads, blog covers and inline images, profile avatars, onboarding logos,
--                   generated stills, youtube thumbnails, chat reference clips.
--   `${brandId}/…`  motion video, voiceover, music. Written by the USER client, not a cron:
--                   routes/app/[brand]/motion-video/+server.ts and .../render/+server.ts pass
--                   `locals.supabase` into render-tools.ts and gemini-audio.ts.
--
-- So a policy keyed on auth.uid() alone is not "stricter", it is broken — it would refuse every
-- motion video a user renders. `auth_brand_ids()` is the predicate the rest of the schema already
-- uses for "the brands this caller may act on" (see "brand-knowledge read shared", 0090); asking
-- the same question the same way is what keeps the answer in one place.

drop policy if exists "Allow authenticated uploads to media bucket" on storage.objects;
drop policy if exists "media insert own folder" on storage.objects;

create policy "media insert own scope" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] in (select b::text from public.auth_brand_ids() b)
    )
  );

-- ── the public buckets: a ceiling, and nothing the browser will execute ──────────────────────────
--
-- Sizes are measured, not guessed. In production today `media` holds 3 089 objects: p50 647 kB,
-- p99 8.4 MB, max 44 MB (a generated mp4) — so `wall`'s 12 MB would reject video outright. 64 MB
-- leaves room above the largest real object without leaving the bucket unbounded. `email-assets`
-- holds 864 objects, max 1.9 MB, and the only writer already refuses anything over 2 MB
-- (weekly-recap.ts), so 5 MB is slack, not a target.
--
-- The mime list exists for ONE reason: `image/svg+xml` is served back with its own content type
-- from a public URL, which makes any bucket that accepts it a place to host script. Storage already
-- demotes text/html to text/plain; SVG is the hole it leaves. There is no denylist in Storage, so
-- the allowlist enumerates images explicitly and falls back to wildcards for video and audio —
-- which keeps every container and codec a phone can produce working (quicktime, webm, m4a, aac)
-- without naming them. `media` holds zero SVGs today, so nothing legitimate is being locked out.

insert into storage.buckets (id, name, public) values ('email-assets', 'email-assets', true)
  on conflict (id) do nothing;

update storage.buckets set
  file_size_limit = 67108864,
  allowed_mime_types = array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'image/avif', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
    'video/*', 'audio/*', 'application/pdf'
  ]
where id = 'media';

update storage.buckets set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
where id = 'email-assets';

-- The two policies the dashboard made for email-assets, written down so a fresh database has them.
-- Read is open because the bucket is public and the URLs go out inside emails; writing is the
-- weekly recap alone, which runs with the service key.
drop policy if exists "email_assets_public_read" on storage.objects;
create policy "email_assets_public_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'email-assets');

drop policy if exists "email_assets_service_upload" on storage.objects;
create policy "email_assets_service_upload" on storage.objects for insert to service_role
  with check (bucket_id = 'email-assets');

-- ── the blog taxonomy: four USING (true) policies nobody reads ───────────────────────────────────
--
-- 0079 and 0080 gave categories, tags, authors and the article/tag join a `public_read` policy so
-- the hosted blog could render for a stranger. It never used them: blog-site.ts reads every public
-- page through the service key, by design ("the visitor is anonymous, so everything reads through
-- the admin client"). What the policies did instead was let an anonymous client read `brand_id` for
-- every brand that has ever created a tag — an enumeration of the tenant list, in exchange for
-- nothing. `brand_articles` itself was never public, so the taxonomy hung off rows anon cannot see.
--
-- Dropping them is the whole fix; the owner policies are FOR ALL and keep members working.

drop policy if exists "blog_categories_public_read" on public.blog_categories;
drop policy if exists "blog_tags_public_read" on public.blog_tags;
drop policy if exists "blog_authors_public_read" on public.blog_authors;
drop policy if exists "article_tags_public_read" on public.brand_article_tags;

-- Defence in depth, the same shape shared_views uses: without the table privilege, a future policy
-- written badly still cannot open these to a visitor. The public blog does not pass here.
revoke all on public.blog_categories from anon;
revoke all on public.blog_tags from anon;
revoke all on public.blog_authors from anon;
revoke all on public.brand_article_tags from anon;

-- ── /a/<code>: a link you can take back ──────────────────────────────────────────────────────────
--
-- The short code is public by decision (20260905090000): whoever holds the link may read the file,
-- because those links travel through the output of external agents and must survive being copied.
-- The decision that was never made is what to do when a link has to stop working — today the only
-- answer is deleting the asset, which also destroys it for the people who should still have it.
--
-- shared_views already answers this, and its answer is the one the red team could not break: a row
-- with a revocation stamp, read on EVERY request rather than trusted once. Same thing here, minus
-- the expiry — a code that expires would break the reason the code exists.

alter table public.brand_media
  add column if not exists link_revoked_at timestamptz;
