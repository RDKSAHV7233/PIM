-- ADR-0015 section 8 (Sprint 5.1c-2): installation-specific provider-verification evidence.
--
-- Expand step only: three nullable columns and two CHECK constraints on connector_installations. Nothing reads or
-- writes them yet (the verifiers and the evaluator's fact derivation ship separately), so deploying this is a no-op
-- for application behavior and old code keeps working unchanged.
--
--   last_provider_verified_at          when a credential was last authenticated AGAINST THE PROVIDER (a call the
--                                      provider answered). Not a stored or unexpired token. Unlike
--                                      last_validation_outcome / last_validation_reason, a later INDETERMINATE
--                                      attempt does not overwrite it, so the trustworthy fact survives an outage.
--   last_provider_verification_kind    what kind of authentication it was, a short upper-case code. TOKEN_ONLY is
--                                      rejected by constraint: a held token is a credential type, not verification.
--   last_provider_verification_reason  optional short upper-case code (never a message or credential)
--
-- NULL is the correct value for every existing row: "never provider-verified since this was recorded". It is not a
-- claim that credentials are invalid. Separate from connector_installations.last_validated_at (which today can be set
-- by a TOKEN_ONLY verifier for amazon-in and flipkart) and from connector_credentials.*, all untouched.
--
-- Rollback (safe while no code writes the columns):
--   ALTER TABLE connector_installations DROP CONSTRAINT IF EXISTS connector_installations_provider_verification_pair_check;
--   ALTER TABLE connector_installations DROP CONSTRAINT IF EXISTS connector_installations_provider_verification_code_check;
--   ALTER TABLE connector_installations DROP COLUMN IF EXISTS last_provider_verification_reason;
--   ALTER TABLE connector_installations DROP COLUMN IF EXISTS last_provider_verification_kind;
--   ALTER TABLE connector_installations DROP COLUMN IF EXISTS last_provider_verified_at;

-- AlterTable
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_provider_verified_at TIMESTAMPTZ NULL;
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_provider_verification_kind TEXT NULL;
ALTER TABLE connector_installations ADD COLUMN IF NOT EXISTS last_provider_verification_reason TEXT NULL;

-- Constraints are added NOT VALID and then validated, so the table is only briefly locked. Every existing row has
-- NULL in all three columns and satisfies both.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connector_installations_provider_verification_pair_check') THEN
    -- The time and the kind are recorded together or not at all; a reason needs a verification to describe.
    ALTER TABLE connector_installations
      ADD CONSTRAINT connector_installations_provider_verification_pair_check
      CHECK (
        (last_provider_verified_at IS NULL) = (last_provider_verification_kind IS NULL)
        AND (last_provider_verification_reason IS NULL OR last_provider_verified_at IS NOT NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connector_installations_provider_verification_code_check') THEN
    ALTER TABLE connector_installations
      ADD CONSTRAINT connector_installations_provider_verification_code_check
      CHECK (
        (last_provider_verification_kind IS NULL
          OR (last_provider_verification_kind ~ '^[A-Z][A-Z0-9_]{0,63}$' AND last_provider_verification_kind <> 'TOKEN_ONLY'))
        AND (last_provider_verification_reason IS NULL OR last_provider_verification_reason ~ '^[A-Z][A-Z0-9_]{0,63}$')
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE connector_installations VALIDATE CONSTRAINT connector_installations_provider_verification_pair_check;
ALTER TABLE connector_installations VALIDATE CONSTRAINT connector_installations_provider_verification_code_check;
