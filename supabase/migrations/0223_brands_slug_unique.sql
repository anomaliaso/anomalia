-- Production has enforced a globally-unique brands.slug via this index long before this file
-- existed: the repo never recorded it, deploys drifted silently, and onboarding hit
-- "duplicate key ... brands_slug_key" whenever two orgs computed the same slug (any non-Latin
-- brand name slugifies to the shared fallback "brand"). Codify what the code must assume.
create unique index if not exists brands_slug_key on public.brands (slug);
