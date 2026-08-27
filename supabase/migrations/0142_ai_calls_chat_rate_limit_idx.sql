-- Chat rate-limit windows query ai_calls by brand + chat labels over the last 7 days.
-- Without this index each chat turn would scan recent rows only via label/created_at globally.
create index if not exists ai_calls_brand_label_created_idx
  on public.ai_calls (brand_id, label, created_at desc)
  where brand_id is not null;
