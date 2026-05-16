-- GIN full-text search index on Product.title
-- Supports fast ilike/contains queries at 50k+ SKU scale.
-- Prisma does not natively support GIN indexes; managed via raw SQL migration.
CREATE INDEX IF NOT EXISTS idx_product_title_fts
ON "Product" USING GIN (to_tsvector('english', title));
