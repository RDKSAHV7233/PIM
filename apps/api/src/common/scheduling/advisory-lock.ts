import { PrismaClient } from "@prisma/client";

function withConnectionLimit(databaseUrl: string, limit: number): string {
  if (databaseUrl.includes("connection_limit=")) {
    return databaseUrl.replace(/([?&])connection_limit=[^&]*/, `$1connection_limit=${limit}`);
  }
  if (databaseUrl.includes("?")) {
    return `${databaseUrl}&connection_limit=${limit}`;
  }
  return `${databaseUrl}?connection_limit=${limit}`;
}

function resolveLockDatabaseUrl(): string {
  // Session-scoped advisory locks require a stable database session. Prefer
  // DATABASE_URL_DIRECT because pooled/transaction-mode URLs may rotate the
  // backend session between the lock and unlock statements.
  const url = String(
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED ?? "",
  ).trim();
  if (!url) {
    throw new Error("No DATABASE_URL_DIRECT/DATABASE_URL/DATABASE_URL_POOLED configured for scheduler locking.");
  }
  return withConnectionLimit(url, 1);
}

/**
 * Runs fn only when this process acquires a session-scoped Postgres advisory
 * lock for lockName. This creates a short-lived, single-connection Prisma
 * client per acquisition, so lock/unlock are tied to the same backend session.
 *
 * Advisory locks are local to one Postgres database. This coordinates Vexa
 * schedulers across replicas only while every replica resolves the same base
 * database URL for scheduler locking.
 */
export async function runWithAdvisoryLock(lockName: string, fn: () => Promise<void>): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url: resolveLockDatabaseUrl() } } });
  try {
    const rows = await client.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${lockName})) AS locked
    `;
    if (!rows[0]?.locked) {
      return false;
    }
    try {
      await fn();
    } finally {
      await client.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockName}))`;
    }
    return true;
  } finally {
    await client.$disconnect();
  }
}
