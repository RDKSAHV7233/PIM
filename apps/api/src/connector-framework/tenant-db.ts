import type { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

/** Thrown instead of silently falling back to the default tenant when a connector has no tenant for a database call. */
export class MissingConnectorTenantError extends Error {
  constructor(message = "Connector database access requires a tenant.") {
    super(message);
    this.name = "MissingConnectorTenantError";
  }
}

/**
 * SEC-DB-RLS-001 M1b: the database client for a KNOWN tenant.
 *
 * Connectors used to read and write their own rows (credentials, submissions, webhook events) through the context-free
 * direct client, which carries no tenant. That works while the runtime role is a superuser and fails the day it is not: with
 * row level security enforced, a client with no tenant sees only the `default` tenant, so reads return nothing and writes are
 * rejected. This returns the tenant client instead (`PrismaService.tenant(tenantKey)`), which sets the tenant on the connection.
 *
 * `prisma` is optional only so that tests which build a connector by hand (and run as the admin identity) keep working; Nest
 * always injects it, and without it the `fallback` (the direct client) is used, as before.
 *
 * A blank tenant is refused. `PrismaService.tenant("")` would quietly mean the default tenant, which is the one failure this
 * migration exists to prevent: a connector call with a missing tenant must not read the default tenant's rows.
 */
export function tenantDb(
  prisma: PrismaService | undefined,
  fallback: { getClient(): PrismaClient },
  tenantKey: string | null | undefined,
): PrismaClient {
  const key = String(tenantKey ?? "").trim();
  if (!key) {
    throw new MissingConnectorTenantError();
  }
  return prisma ? prisma.tenant(key) : fallback.getClient();
}
