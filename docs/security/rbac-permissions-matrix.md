---
title: RBAC Permissions Matrix
audience: internal-eng
status: active
last_updated: 2026-05-26
owner: Engineering / QA
---

Use this document to verify what any role can and cannot do across every product surface. Source of truth: `apps/api/src/common/rbac/roles.ts`, controller `@Roles()` decorators, and `rbac.guard.ts`.

## 1. Role Definitions

| Role | Primary surface |
|------|----------------|
| `admin` | Full access to all product, channel, connector, and workspace operations |
| `editor` | Edit catalog, import products, manage categories and attributes |
| `publisher` | Publish approved products to channels; cannot edit catalog content |
| `approver` | Approve or reject products in review; cannot edit catalog content |
| `channel_manager` | Manage channel mappings, connector configurations, readiness gates |
| `connector_admin` | Install, configure, and manage connector credentials and installations |
| `reviewer` | Read catalog and submission data, add comments |
| `viewer` | Read-only access to catalog and reporting |

Default write roles (undecorated mutations): `admin`, `editor`.  
Admin-boundary routes (API keys, workspace users): `admin` only; machine API clients disallowed.

---

## 2. Permissions Matrix

Legend: **R** = read, **W** = write/mutate, **—** = denied

| Surface | admin | editor | publisher | approver | channel_manager | connector_admin | reviewer | viewer |
|---------|-------|--------|-----------|----------|-----------------|-----------------|----------|--------|
| **Catalog — browse & search** | R | R | R | R | R | R | R | R |
| **Catalog — create product** | W | W | — | — | — | — | — | — |
| **Catalog — edit product** | W | W | — | — | — | — | — | — |
| **Catalog — delete / purge product** | W | W | — | — | — | — | — | — |
| **Catalog — submit for review** | W | W | — | — | — | — | — | — |
| **Catalog — workflow transitions** | W | W | — | — | — | — | — | — |
| **Catalog — bulk edit** | W | W | — | — | — | — | — | — |
| **Catalog — bulk import (upload)** | W | W | — | — | — | — | — | — |
| **Catalog — bulk import (read)** | R | R | R | R | R | R | R | R |
| **Catalog — categories** | W | W | — | — | — | — | — | — |
| **Catalog — attributes** | W | W | — | — | — | — | — | — |
| **Quality — validation issues** | R | R | R | R | R | R | R | R |
| **Quality — resolve issues** | W | W | — | — | — | — | — | — |
| **Quality — completeness** | R | R | R | R | R | R | R | R |
| **Quality — approval queue (read)** | R | R | R | R | R | R | R | R |
| **Quality — approve / reject** | W | — | — | W | — | — | — | — |
| **Quality — approval comments** | W | W | W | W | W | W | W | — |
| **Channels — channel readiness** | R | R | R | R | R | R | R | R |
| **Channels — publish / queue export** | W | — | W | — | W | — | — | — |
| **Channels — channel mappings** | W | — | — | — | W | — | — | — |
| **Channels — connector setup** | W | — | — | — | W | W | — | — |
| **Connectors — definitions (read)** | R | R | R | R | R | R | R | R |
| **Connectors — install** | W | — | — | — | — | W | — | — |
| **Connectors — credentials** | W | — | — | — | — | W | — | — |
| **Connectors — account health** | R | — | — | — | — | R | — | — |
| **Operations — import runs** | R | R | R | R | R | R | R | R |
| **Operations — submission jobs** | R | R | R | R | R | R | R | R |
| **Operations — dead letter queue** | R | R | R | R | R | R | R | R |
| **Media — upload** | W | W | — | — | — | — | — | — |
| **Media — view / browse** | R | R | R | R | R | R | R | R |
| **Admin — workspace settings** | W | — | — | — | — | — | — | — |
| **Admin — user management** | W | — | — | — | — | — | — | — |
| **Admin — API keys** | W | — | — | — | — | — | — | — |
| **Admin — outbound webhooks** | W | — | — | — | — | — | — | — |
| **Admin — OIDC SSO config** | W | — | — | — | — | — | — | — |
| **Admin — audit log** | R | — | — | — | — | — | — | — |
| **Admin — plan & billing** | R/W | R | R | R | R | R | R | R |
| **Admin — privacy (export/delete)** | W | — | — | — | — | — | — | — |
| **Platform — tenant search (internal)** | W (ops token) | — | — | — | — | — | — | — |

---

## 3. API Key Clients

Machine API clients (authenticated via API key) follow the same role permissions above but are additionally restricted:

- Cannot access admin-boundary routes (user management, API keys, privacy controls)
- Cannot perform step-up authenticated operations (OIDC config)
- Allowed scopes: `catalog.read`, `catalog.write`, `bulk_import.read`, `media.read`, `compliance.read`, `issues.read`, `rejection_intelligence.read`, `auto_suggestions.read`, `taxonomy.read`

---

## 4. Verification

Run the RBAC integration tests to verify live role enforcement:

```bash
node apps/api/test/integration/rls-isolation.test.cjs
node apps/api/test/integration/admin-users-route-contract.test.cjs
node apps/api/test/integration/auth-oidc-config-step-up.test.cjs
```

Check any new endpoint against the source decorators:

```bash
grep -r "@Roles(" apps/api/src --include="*.ts"
grep -r "@DisallowApiClient" apps/api/src --include="*.ts"
grep -r "@AdminBoundaryAccess" apps/api/src --include="*.ts"
```
