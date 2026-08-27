-- 0177 — Drive brand scope is Picker files (drive.file) plus optional legacy folders.

comment on column public.brand_knowledge_sources.settings is
  'Provider-specific options. GitHub: { "repos": ["owner/name"] }. Drive: { "files": [{ "id", "name", "mimeType" }], "folders": [{ "id", "name" }] }. Notion: { "pages": [{ "id", "title", "kind" }] }.';
