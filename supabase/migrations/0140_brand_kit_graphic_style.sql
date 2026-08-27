-- Typography + art direction for programmatically composed graphics.
--
-- Separate from brand_kit.fonts on purpose: that column holds what was DETECTED on the brand's
-- website, which is frequently a serif display face that reads badly at post scale — and frequently
-- a font the graphic renderer cannot load at all, so it silently fell back to Inter. This column is
-- what the brand has CHOSEN for its graphics, and what it chose is guaranteed to render because the
-- Studio validates the family against Google Fonts before saving it.
--
-- Shape: { display_font: string, body_font: string, instructions: string }
alter table public.brand_kit add column if not exists graphic_style jsonb;
