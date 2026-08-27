-- 0188: mark the auto-publish plumbing as dead, without dropping it yet.
--
-- Auto-publishing was removed in the AI Act pass: every post now waits for a human to approve that
-- specific post, which is what the Art. 50(2) exemption for human-reviewed text rests on. Nothing
-- in the application reads `social_accounts.auto_publish` or `brands.content_prefs -> 'publishing'`
-- any more (enforced by src/lib/server/publishing-settings.test.ts).
--
-- The data is left in place deliberately: a DROP is irreversible and the historical values are the
-- only record of which brands had opted into full autonomy. Comment now, drop in a later migration
-- once the code has been in production long enough that a rollback is off the table.

comment on column public.social_accounts.auto_publish is
  'DEPRECATED (0188): unread since auto-publish was removed. Every post waits for human approval. Do not read; do not reintroduce.';
