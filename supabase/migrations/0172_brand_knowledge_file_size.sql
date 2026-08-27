-- Chat attachments may be up to 100 MB (uploaded to Storage, converted server-side).
-- Knowledge ingest still rejects > 20 MB in application code.
update storage.buckets
set file_size_limit = 104857600
where id = 'brand-knowledge';
