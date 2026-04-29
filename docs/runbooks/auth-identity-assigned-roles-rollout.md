# AuthIdentity Assigned Roles Rollout

This runbook covers the additive rollout of `AuthIdentity.assigned_roles` in Vexa PIM.

## Purpose

Use this rollout only to backfill scalar-role compatibility into `assigned_roles` without changing the scalar `role` field.

The rollout contract is intentionally narrow:

- scalar `role` remains the compatibility field
- backfill only touches rows where `assigned_roles` is `NULL` or `[]`
- backfill copies the normalized scalar app role into `assigned_roles`
- rows with existing non-empty `assigned_roles` are left alone
- rows with invalid scalar `role` are skipped, not guessed
- rollback only clears rows whose `assigned_roles` exactly equals the scalar singleton that this rollout would have written

## Preconditions

- migration `20260429113000_add_auth_identity_assigned_roles` is already applied
- scalar-role fallback is still present in runtime auth resolution
- no scalar-role removal rollout is in flight

## Dry Run

Preview additive backfill candidates for one tenant:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --tenant <tenantKey> --dry-run
```

Preview rollback candidates for one tenant:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --tenant <tenantKey> --rollback --dry-run
```

Preview across all tenants:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --dry-run
node scripts/auth-identity-assigned-roles-rollout.cjs --rollback --dry-run
```

## Apply Backfill

Execute additive backfill for one tenant:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --tenant <tenantKey> --confirm
```

Execute additive backfill across all tenants:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --confirm
```

Expected behavior:

- `viewer` -> `assigned_roles = ["viewer"]`
- `reviewer` -> `assigned_roles = ["reviewer"]`
- `editor` -> `assigned_roles = ["editor"]`
- `admin` -> `assigned_roles = ["admin"]`
- invalid scalar roles are skipped
- pre-existing non-empty `assigned_roles` are preserved

## Rollback

Preview rollback:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --tenant <tenantKey> --rollback --dry-run
```

Execute rollback:

```powershell
node scripts/auth-identity-assigned-roles-rollout.cjs --tenant <tenantKey> --rollback --confirm
```

Rollback is intentionally limited:

- only rows whose `assigned_roles` exactly equals `[role]` are cleared
- true multi-role rows are not touched
- scalar-role fallback remains the live compatibility path after rollback

## Verification

Recommended verification commands:

```powershell
npm run build --workspace @pim1/api
node apps/api/test/integration/auth-assigned-roles-rollout-runbook.test.cjs
node apps/api/test/integration/auth-assigned-roles-read-path.test.cjs
node apps/api/test/integration/auth-local-assigned-roles-bridge.test.cjs
node apps/api/test/integration/workspace-user-crud.test.cjs
```

Key checks after backfill:

- users with prior `NULL` or `[]` role sets still authenticate
- editor scalar users still reach editor-only reads
- viewer and reviewer scalar users remain denied editor-only reads
- existing multi-role rows remain unchanged
- invalid scalar-role rows were skipped

Key checks after rollback:

- rows written as scalar singletons are cleared back to `[]`
- scalar-role fallback still preserves legacy access
- no new admin-boundary or editor privileges appear

## Risk Notes

- This rollout does not assign admin-boundary roles such as `system_admin`, `product_admin`, or `super_admin`
- This rollout does not remove scalar `role`
- This rollout is not a full multi-role migration
- If a tenant already uses real multi-role assignments, rollback intentionally avoids clearing those rows
