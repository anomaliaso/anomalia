-- Raw provider credits for flat-fee billing (kie.ai credits_consumed). USD cost stays in cost_usd.
alter table public.ai_calls add column if not exists provider_credits numeric(12, 6);
