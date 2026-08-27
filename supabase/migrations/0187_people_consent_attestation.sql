-- 0187 people: make likeness consent a recorded act, not an assumption.
--
-- `people.consent` has existed since 0028 ("real people must confirm likeness consent") but every
-- creation path wrote `true` unconditionally — Studio, the AI builder, onboarding, and the
-- import-from-socials flow. The column therefore asserted a consent nobody had given, which is
-- harder to defend in an audit than an empty field.
--
-- Under the AI Act a UGC clip built on a real person's photo, speaking a synthetic voice, is a
-- deepfake (Art. 3(60)); the likeness and voice of an identifiable person also engage image rights
-- and the GDPR. From here, consent for a real person is something the brand owner states, with a
-- timestamp and a provenance, and generation is gated on it.
--
-- Existing rows are GRANDFATHERED on purpose: flipping them to false would break every brand's
-- UGC pipeline at deploy time. They keep consent = true and are stamped
-- consent_source = 'legacy_assumed', so which rows were never really attested stays answerable.

alter table public.people
  add column if not exists consent_at timestamptz,
  add column if not exists consent_source text;

comment on column public.people.consent is
  'Likeness consent for a real person. Gated in resolvePeopleVisualRefs: a kind=''real'' person with consent = false is never fed to an image or video generator.';
comment on column public.people.consent_at is
  'When consent was attested. Null on rows created before migration 0187.';
comment on column public.people.consent_source is
  'How consent was established: owner_attested (a person ticked the box) | ai_generated (no real person involved) | legacy_assumed (pre-0187, written by code, never attested).';

update public.people
   set consent_source = case when kind = 'ai' then 'ai_generated' else 'legacy_assumed' end
 where consent_source is null;
