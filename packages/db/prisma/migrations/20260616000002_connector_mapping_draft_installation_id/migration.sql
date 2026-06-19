-- Add draft_installation_id to connector_mapping_versions.
-- Records which connector account (installation) was active when the draft was authored.
-- Used to enforce account-consistency at publish time: if the publish request names a
-- different installation than the one used to create the draft, the request is rejected
-- with account_mismatch_draft_vs_publish (409).

ALTER TABLE "connector_mapping_versions"
  ADD COLUMN IF NOT EXISTS "draft_installation_id" TEXT;
