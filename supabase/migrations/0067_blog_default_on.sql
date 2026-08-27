-- New brands (created via onboarding) get the blog ENABLED by default, so Anomalia plans/generates
-- blog articles alongside social from day one. Existing brands keep blog_config = null (off) until
-- they opt in from the Blog page — they see the "enable your blog" suggestion in the meantime.
alter table public.brands alter column blog_config set default '{"enabled": true}'::jsonb;
