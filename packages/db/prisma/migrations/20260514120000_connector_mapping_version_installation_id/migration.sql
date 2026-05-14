-- Add nullable installation_id to connector_mapping_versions for installation-scoped mappings.
-- Existing rows keep NULL, retaining full backward compatibility with slug-scoped resolution.
ALTER TABLE "connector_mapping_versions"
  ADD COLUMN IF NOT EXISTS "installation_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_connector_mapping_versions_installation"
  ON "connector_mapping_versions" ("tenant_key", "installation_id", "category_scope", "lifecycle_state");
