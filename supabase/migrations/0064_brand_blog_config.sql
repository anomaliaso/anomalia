-- Per-brand blog UI customization (title, favicon/icon, accent colour, font). One blog per brand →
-- a single jsonb on the brand. Shape: { title, iconUrl, accent, font }.
alter table public.brands add column if not exists blog_config jsonb;
