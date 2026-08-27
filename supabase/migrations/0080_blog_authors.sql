-- Blog authors (bylines) referenced by blog-site.ts and the site editor.
CREATE TABLE blog_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  bio text,
  avatar_url text,
  role text DEFAULT 'writer',
  created_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, slug)
);
ALTER TABLE blog_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_authors_owner" ON blog_authors
  USING (brand_id IN (SELECT id FROM brands WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "blog_authors_public_read" ON blog_authors FOR SELECT USING (true);

-- FK so PostgREST can embed author:blog_authors(...) from brand_articles.
ALTER TABLE brand_articles ADD COLUMN author_id uuid REFERENCES blog_authors(id) ON DELETE SET NULL;
