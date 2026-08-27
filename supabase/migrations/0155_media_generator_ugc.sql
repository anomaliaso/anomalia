-- 0155: tag Media generator items/prompts as UGC so UGC Creator can filter the grid.

alter table public.media_generator_items
  add column if not exists ugc boolean not null default false;

alter table public.media_generator_prompts
  add column if not exists ugc boolean not null default false;

create index if not exists media_generator_items_brand_ugc_created_idx
  on public.media_generator_items (brand_id, created_at desc)
  where ugc = true and kind = 'video';

create index if not exists media_generator_prompts_brand_ugc_created_idx
  on public.media_generator_prompts (brand_id, created_at desc)
  where ugc = true;
