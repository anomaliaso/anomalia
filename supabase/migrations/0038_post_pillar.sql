-- 0038: per-post pillar ("Scopo"). The strategist now tags every seed with the content pillar it
-- serves (e.g. "CTA verso sito", "UGC e recensioni"); produced posts keep it so the weekly table
-- shows WHY each row exists across its whole lifecycle (da produrre → generato → pubblicato).
alter table public.posts add column if not exists pillar text;
