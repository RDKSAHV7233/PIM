#!/usr/bin/env node
/* Read-only: given the smoke user's email, report which tenantKey their
 * AuthIdentity row lives under and which workspaceSlug maps to that tenantKey,
 * so STAGING_SMOKE_WORKSPACE/STAGING_SMOKE_TENANT_ID can be reconciled. */
const { PrismaClient } = require("@prisma/client");

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const databaseUrl = String(
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "",
  ).trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_DIRECT or DATABASE_URL_POOLED or DATABASE_URL is required.");
  }
  const userId = requireEnv("SMOKE_USER_ID").trim().toLowerCase();

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const identity = await prisma.authIdentity.findUnique({
      where: { userId },
      select: { userId: true, tenantKey: true, role: true, isActive: true, lockedUntil: true },
    });

    if (!identity) {
      console.log(JSON.stringify({ status: "no-identity-found", userId }, null, 2));
      return;
    }

    const workspace = await prisma.workspaceDirectory.findUnique({
      where: { tenantKey: identity.tenantKey },
      select: { workspaceSlug: true, tenantKey: true, isActive: true, displayName: true },
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          identity,
          matchingWorkspaceDirectoryRow: workspace ?? "no-workspace-directory-row-for-this-tenantKey",
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
