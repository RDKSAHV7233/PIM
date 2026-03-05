# ADR-001 Tenant Scoping Strategy

## Status
Accepted

## Problem
Every tenant-scoped query must reliably include tenant isolation under connection pooling and concurrent requests.

## Options Considered
1. Prisma client extensions to append `where: { tenantId/tenantKey }`.
2. Database session variable (`app.tenant_key`) + RLS policies, with one Prisma client per tenant context.

## Decision
Use option 2 in the current implementation:
- `main.ts` resolves tenant from JWT/header and sets async tenant context.
- `PrismaService` builds tenant-specific datasource URLs with `options=-c app.tenant_key=<tenant>`.
- Postgres RLS policies enforce row access against `current_setting('app.tenant_key', true)`.

## Consequences
- Centralized enforcement at DB policy layer.
- Requires continuous verification (`scripts/verify-tenant-rls.cjs`) after migrations.
- Unsafe raw SQL must explicitly document manual tenant filtering with:
  `// RLS-BYPASS: manual tenant filter`.
