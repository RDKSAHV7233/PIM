-- Add draft_installation_id to connector_mapping_versions to record which
-- connector account was active when the draft was created. Used at publish time
-- to detect and reject account mismatches (prevents silent readiness evals
-- against a different account than the one used to build the draft).
ALTER TABLE "connector_mapping_versions"
  ADD COLUMN IF NOT EXISTS "draft_installation_id" TEXT;
