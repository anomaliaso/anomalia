-- Full-text search vector for blog articles
ALTER TABLE brand_articles ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION brand_articles_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.meta_title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.meta_description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.body_md, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_articles_search_vector ON brand_articles;
CREATE TRIGGER trg_articles_search_vector
  BEFORE INSERT OR UPDATE ON brand_articles
  FOR EACH ROW EXECUTE FUNCTION brand_articles_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_brand_articles_search ON brand_articles USING gin(search_vector);

-- Backfill existing articles
UPDATE brand_articles SET search_vector =
  setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(meta_title, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(meta_description, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(body_md, '')), 'C')
WHERE search_vector IS NULL;
