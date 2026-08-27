-- 0090 brand-knowledge shared read: let brand members see the brand's private files.
-- 0077 widened auth_brand_ids() so members can read brand-scoped TABLES, but the
-- storage policies on the private brand-knowledge bucket (0021) still only let the
-- original uploader read their own files (first path segment = their auth.uid()).
-- Effect: an invited member saw the brand_documents rows (empty tiles) but every
-- signed-URL request failed, so reference images / people portraits / history thumbs
-- rendered blank. Files live under `${uploaderUid}/${brandId}/...`, so authorise by
-- the SECOND segment (the brand id) against the brands the caller can access.
--
-- Additive to "brand-knowledge read own" — the owner keeps access; members gain it.
-- Compared as text so non-brand paths (e.g. `${uid}/onboarding/...`) simply don't
-- match instead of erroring on a uuid cast.

create policy "brand-knowledge read shared" on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-knowledge'
    and (storage.foldername(name))[2] in (
      select b::text from public.auth_brand_ids() b
    )
  );
