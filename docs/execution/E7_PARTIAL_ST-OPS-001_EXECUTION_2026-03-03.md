# E7 Partial Execution Record (ST-OPS-001)

- Date: 2026-03-03
- Scope: `E7 Runtime Reliability and Ops Gates` (partial)
- Story completed in this pass: `ST-OPS-001 Encryption versioning and key rotation`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`

## ST-OPS-001: Encryption versioning and key rotation
- PRD mapping: `NFR-003`
- Status: Complete
- Acceptance evidence:
1. Key-versioned encryption utilities implemented in [credential-encryption.util.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-installer\credential-encryption.util.ts) with:
   - version parsing/formatting (`v1`, `v2`, ...),
   - deterministic key derivation from env values,
   - AES-256-GCM encrypt/decrypt payload handling.
2. Rotation-capable service implemented in [credential-encryption.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-installer\credential-encryption.service.ts):
   - `encrypt()` writes current key version,
   - `decrypt(cipher, keyVersion)` uses row metadata version,
   - `rotateKey({ fromVersion, toVersion, dryRun })` supports dry-run and execute modes.
3. Connector installer module wiring added in [connector-installer.module.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-installer\connector-installer.module.ts) so rotation/encryption service is available for connector credential flows.
4. Environment validation extended for multi-version keys in [env-validation.ts](C:\Users\Om Computers\PIM1\apps\api\src\common\env-validation.ts), including current-version key presence checks.
5. Rotation CLI added as [rotate-credentials.ts](C:\Users\Om Computers\PIM1\scripts\rotate-credentials.ts) with:
   - `--from`, `--to`, `--dry-run`, `--confirm`,
   - guardrails requiring either dry-run or confirm,
   - JSON output with rotated/failed counts.
6. Integration proof for storage/decrypt/rotation behavior in [credential-rotation.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\credential-rotation.test.cjs).
7. Operational runbook published in [credential-key-rotation.md](C:\Users\Om Computers\PIM1\docs\runbooks\credential-key-rotation.md).

## Gate Checks (this pass)
- `npm run test:integration:credential-rotation` -> Pass
- `npm run test:integration:auth-revocation` -> Pass
- `npm run test:integration:rls-isolation` -> Pass
- `npm run test:integration:env-validation` -> Pass
- `npm run test:integration:cursor-pagination` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass
- `npm run guard:unsafe-raw` -> Pass

## Remaining E7 stories
- `ST-OPS-002` Worker backpressure and limits -> Pending
- `ST-OPS-005` Staging-only gate sign-off -> Pending
