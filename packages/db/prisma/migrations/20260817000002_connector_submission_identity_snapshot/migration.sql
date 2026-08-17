-- Snapshot connector identity onto each submission so history stays interpretable
-- after the owning connector_installations row is deleted (see the preceding
-- 20260817000001 migration, which drops the cascading FK that used to remove
-- this history alongside the installation).
--
-- Without this, a resolved submission that survives installation deletion would
-- have no connector-installer join target left (deleted) and no other identity
-- field on the row itself — effectively an anonymous "some connector, once" entry.

ALTER TABLE connector_submissions
  ADD COLUMN IF NOT EXISTS connector_slug text,
  ADD COLUMN IF NOT EXISTS connector_display_name text;

UPDATE connector_submissions cs
SET
  connector_slug = COALESCE(cs.connector_slug, cd.slug),
  connector_display_name = COALESCE(cs.connector_display_name, cd.display_name)
FROM connector_installations ci
JOIN connector_definitions cd ON cd.id = ci.connector_id
WHERE ci.id = cs.installation_id
  AND ci.tenant_key = cs.tenant_key
  AND (cs.connector_slug IS NULL OR cs.connector_display_name IS NULL);

CREATE INDEX IF NOT EXISTS idx_connector_submissions_tenant_connector_status
  ON connector_submissions (tenant_key, connector_slug, status);
