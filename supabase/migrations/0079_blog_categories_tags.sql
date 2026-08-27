-- Blog categories (sections) for organizing articles
CREATE TABLE blog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, slug)
);
ALTER TABLE blog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_categories_owner" ON blog_categories
  USING (brand_id IN (SELECT id FROM brands WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "blog_categories_public_read" ON blog_categories FOR SELECT USING (true);

-- Blog tags (free-form labels)
CREATE TABLE blog_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, slug)
);
ALTER TABLE blog_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_tags_owner" ON blog_tags
  USING (brand_id IN (SELECT id FROM brands WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "blog_tags_public_read" ON blog_tags FOR SELECT USING (true);

-- Junction: article <-> tag (many-to-many)
CREATE TABLE brand_article_tags (
  article_id uuid REFERENCES brand_articles(id) ON DELETE CASCADE,
  tag_id uuid REFERENCES blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);
ALTER TABLE brand_article_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "article_tags_owner" ON brand_article_tags
  USING (article_id IN (
    SELECT ba.id FROM brand_articles ba
    JOIN brands b ON b.id = ba.brand_id
    WHERE b.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  ));
CREATE POLICY "article_tags_public_read" ON brand_article_tags FOR SELECT USING (true);

-- Add category_id to brand_articles
ALTER TABLE brand_articles ADD COLUMN category_id uuid REFERENCES blog_categories(id) ON DELETE SET NULL;
