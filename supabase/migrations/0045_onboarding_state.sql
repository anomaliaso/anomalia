-- 0045: the new chat-driven onboarding's state machine, per brand. A single jsonb holds the current
-- phase, the per-section statuses, and the overall onboarding status (in_progress | paused |
-- completed). NULL = never started → the app treats it as in_progress/welcome. This is the basis of
-- the conversational onboarding that replaces the old blocking auto-build (setup_step/SetupDialog):
-- the user lives the whole flow in the Panoramica chat, can skip (= pause, resumable later), and
-- the side pages get filled in the background as each phase is approved.
alter table public.brands add column if not exists onboarding_state jsonb;
