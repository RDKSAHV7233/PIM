# Credential Key Rotation Runbook

This runbook rotates `connector_credentials.encrypted_value` from one key version to another using `scripts/rotate-credentials.ts`.

## Prerequisites
- `CREDENTIAL_ENCRYPTION_KEY_V{from}` and `CREDENTIAL_ENCRYPTION_KEY_V{to}` are present in environment.
- `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION` points to the version used for new encryptions.
- Database access is healthy (`DATABASE_URL_DIRECT` configured).

## Rotation Steps
1. Take a full database backup (`pg_dump`) before any rotation run.
2. Add the new key to environment (example: `CREDENTIAL_ENCRYPTION_KEY_V2`) without removing old key.
3. Run dry-run:
   - `npm run credentials:rotate -- --from 1 --to 2 --dry-run`
4. Review dry-run output (`rotated`, `failed`, and `errors`).
5. Execute real rotation:
   - `npm run credentials:rotate -- --from 1 --to 2 --confirm`
6. Verify post-rotation counts:
   - `SELECT key_version, COUNT(*) FROM connector_credentials GROUP BY key_version;`
7. Update `CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION` to the new version for future writes.
8. Redeploy API and run integration checks:
   - `npm run test:integration:credential-rotation`

## Safety Notes
- `--dry-run` never writes to DB.
- `--confirm` is required for write mode.
- Rotation logs never print credential plaintext or encrypted payload values.
