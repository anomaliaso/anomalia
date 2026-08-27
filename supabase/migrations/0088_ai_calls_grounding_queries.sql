-- How many Google Search queries a grounded call actually performed (groundingMetadata.
-- webSearchQueries). Each is billed $14/1k on Gemini 3.x once past the 5k/month free tier;
-- cost_usd includes them at full price (prudent upper bound — the free tier is not modeled).
alter table ai_calls add column if not exists grounding_queries integer;
