-- 0200: did the composition build the structure it studied?
--
-- 0195 keeps the craft verdict — how well the clip is MADE. This keeps the other half: whether the
-- beat sheet the agent studied off the reference wall survived into the MP4. A beautifully eased
-- composition that shares nothing with the reference it was built from scores well on craft and is
-- a failure of the feature, and until now nothing could tell the two apart.
--
-- Nullable on purpose: most compositions are written without the wall, and for those there is no
-- reference to be faithful to. Absent means "not applicable", never zero.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.motion_craft_scores
  add column if not exists reference_fidelity numeric;

alter table public.motion_craft_scores
  add column if not exists reference_order_kept boolean;

-- Beats the study marked reachable — the denominator of the score. An [OUT OF REACH] beat is one
-- the spec told the agent to drop, so it is deliberately not counted either way.
alter table public.motion_craft_scores
  add column if not exists reference_beats_checked int;

alter table public.motion_craft_scores
  add column if not exists reference_beats_missing int;

create index if not exists motion_craft_scores_fidelity_idx
  on public.motion_craft_scores (reference_fidelity, overall)
  where reference_fidelity is not null;
