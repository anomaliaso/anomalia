-- Lock flag for visual_style: when true, rebuildBrandContext and stageBrandAnalysis
-- skip overwriting the visual brief, so the user's manual edits persist.
alter table public.brand_kit
  add column if not exists visual_style_locked boolean not null default false;
