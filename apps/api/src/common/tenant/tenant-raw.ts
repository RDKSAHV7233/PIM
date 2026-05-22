import type { PrismaClient } from "@prisma/client";

/**
 * Executes a raw SQL SELECT that MUST include a manual `tenant_key` filter.
 *
 * Why this exists
 * ---------------
 * Prisma's `createTenantScopeExtension` automatically injects `tenantKey` into
 * all ORM queries, but raw SQL bypasses that extension. Each raw call site
 * must therefore include a manual `WHERE ... tenant_key = $N` clause.
 *
 * This helper makes that contract explicit and enforced:
 *   - Pass the already-scoped client from `prisma.tenant(tenantKey)`.
 *   - Pass the full params array (tenantKey at whichever position the SQL needs).
 *   - In non-production environments a runtime assertion fires if `tenant_key`
 *     is absent from the SQL, catching mistakes before they reach production.
 *
 * Usage
 * -----
 *   const rows = await tenantRaw<SubmissionRow[]>(
 *     this.prisma.tenant(tenantKey),
 *     `SELECT * FROM connector_submissions
 *      WHERE tenant_key = $1 AND id = $2`,
 *     [tenantKey, submissionId],
 *   );
 */
export async function tenantRaw<T = unknown>(
  client: PrismaClient,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  assertTenantKeyPresent(sql);
  // RLS-BYPASS: manual tenant filter
  return client.$queryRawUnsafe<T>(sql, ...params);
}

/**
 * Same guarantee as `tenantRaw` but for write operations (INSERT / UPDATE / DELETE).
 * Returns the number of affected rows.
 */
export async function tenantExecRaw(
  client: PrismaClient,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  assertTenantKeyPresent(sql);
  // RLS-BYPASS: manual tenant filter
  return client.$executeRawUnsafe(sql, ...params);
}

function assertTenantKeyPresent(sql: string): void {
  if (process.env["NODE_ENV"] === "production") {
    return; // rely on correct code in production; avoid runtime overhead
  }
  if (!sql.toLowerCase().includes("tenant_key")) {
    throw new Error(
      `tenantRaw: SQL is missing a 'tenant_key' reference - cross-tenant data leak risk.\n` +
        `SQL (first 300 chars): ${sql.trim().slice(0, 300)}`,
    );
  }
}
