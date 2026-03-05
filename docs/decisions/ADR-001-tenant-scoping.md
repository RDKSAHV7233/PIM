# ADR-001: Tenant Scoping Strategy

- Date: 2026-03-04
- Status: Accepted

## Problem
Tenant isolation must hold for all API reads/writes and background processing while using pooled DB connections.

## Options Considered
1. PostgreSQL `SET LOCAL app.tenant_key` on every request.
2. Prisma client extension that injects `tenantKey` filters into tenant-scoped queries.
3. Service-layer manual filters only.

## Decision
Use Prisma client extension as the primary tenant-scoping mechanism and keep RLS verification in CI.

## Consequences
- Positive: deterministic tenant filtering in app code path, less connection-state coupling.
- Positive: CI catches schema/policy drift via `verify-tenant-rls.cjs`.
- Negative: unsafe raw SQL paths require explicit manual tenant filters and review guard.
