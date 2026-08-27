-- 0173: website captures (demo-account harvest / capture_website) save PNGs into
-- brand_media. The live source check did not include that origin.
alter table public.brand_media drop constraint if exists brand_media_source_check;
alter table public.brand_media
  add constraint brand_media_source_check
  check (
    source = any (
      array[
        'upload'::text,
        'chat_drop'::text,
        'shoot'::text,
        'generate'::text,
        'remotion_export'::text,
        'post_render'::text,
        'website_capture'::text
      ]
    )
  );
