-- Heartbeat credential-validation facts, recorded per installation.
--
-- Expand step only: four nullable columns and one index. Nothing reads or writes them
-- yet (the heartbeat change that uses them ships separately), so deploying this is a
-- no-op for application behavior and old code keeps working unchanged.
--
--   last_validated_at           when authenticated provider validation last SUCCEEDED
--   last_validation_attempt_at  when validation was last ATTEMPTED (any outcome); orders
--                               the heartbeat batch so every installation is visited
--   last_validation_outcome     VALID | INVALID | INDETERMINATE | CONFIGURATION_ERROR
--   last_validation_reason      short safe code only (never a message or credential)
--
-- NULL is the correct value for every existing row: "never validated since this was
-- recorded". It is not a claim that credentials are invalid. This is separate from
-- connector_credentials.last_validated_at / failure_reason, which are per-credential
-- facts (used for Flipkart and Amazon India) and are untouched.
--
-- The index matches the heartbeat's batch order (status filter, oldest attempt first,
-- then id). Rollback: DROP INDEX idx_connector_installations_status_validation_attempt;
-- then DROP the four columns. Safe at any time while no code writes them.

-- AlterTable
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ NULL;
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_validation_attempt_at TIMESTAMPTZ NULL;
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_validation_outcome TEXT NULL;
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_validation_reason TEXT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS idx_connector_installations_status_validation_attempt
  ON connector_installations (status, last_validation_attempt_at, id);
