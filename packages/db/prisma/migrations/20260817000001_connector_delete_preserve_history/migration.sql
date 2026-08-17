-- Preserve immutable connector history when a connector installation is permanently deleted.
--
-- connector_submissions and connector_webhook_events were created with
-- `installation_id ... REFERENCES connector_installations(id) ON DELETE CASCADE`
-- (see 20260304130000_connector_framework_tables). That means the CURRENT bare
-- `DELETE FROM connector_installations` in ConnectorInstallerService.deleteInstallation
-- silently cascade-deletes every historical submission and webhook event for that
-- installation today — audit/compliance evidence disappears with no record it ever
-- existed.
--
-- The new deleteInstallationTransaction() (apps/api/src/connector-installer/
-- connector-installer.service.ts) explicitly blocks deletion while any submission
-- is still active (status = 'PENDING') before this migration's guarantee is relied
-- on, so only resolved (SUCCESS/REJECTED/SUPPRESSED/ERROR) history can ever remain
-- after a deletion — dropping cascade here is what lets that resolved history
-- survive instead of vanishing.
ALTER TABLE connector_submissions
  DROP CONSTRAINT IF EXISTS connector_submissions_installation_id_fkey;

ALTER TABLE connector_webhook_events
  DROP CONSTRAINT IF EXISTS connector_webhook_events_installation_id_fkey;
