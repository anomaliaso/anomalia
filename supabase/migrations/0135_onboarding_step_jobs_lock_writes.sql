-- 0135: onboarding_step_jobs is read-only to the client.
--
-- 0133 shipped `insert own` + `update own` so the wizard could enqueue and supersede jobs with the
-- user-scoped client. Both are reachable straight from the browser (anon key + the user's JWT are
-- public), which made the queue a spend amplifier:
--   * insert  → enqueue any kind with any input, skipping the route's canEnter() gate
--   * update  → flip a finished job back to 'pending' (or reset attempts) and the worker re-runs the
--               full research / image pipeline, on demand, for free
-- Every write now goes through the service role in startOnboardingStepJob(), which bypasses RLS —
-- same shape as onboarding_jobs (0040). The owner keeps SELECT so the page can still poll.

drop policy if exists "onboarding_step_jobs insert own" on public.onboarding_step_jobs;
drop policy if exists "onboarding_step_jobs update own" on public.onboarding_step_jobs;
