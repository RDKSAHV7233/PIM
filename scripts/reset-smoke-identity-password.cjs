#!/usr/bin/env node
/* eslint-disable no-console */
// Resets ONE specific, explicitly-identified AuthIdentity's password hash to a
// given plaintext password. This performs an unconditional reset for one named
// maintenance/smoke-test identity's actual stored credential. Requires explicit
// --tenant and --user; refuses to run without both, so it can never accidentally
// match more than one identity.
//
// STAGING_SMOKE_PASSWORD is the authoritative credential for the dedicated
// staging smoke identity. PIM_AUTH_PASSWORD is not a synchronization mechanism
// for DB-backed identities and is intentionally not used here.
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

function parseArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return String(process.argv[idx + 1] ?? "").trim() || null;
}

async function run() {
  const tenantKey = parseArg("tenant");
  const userId = parseArg("user");
  const newPassword = String(process.env.RESET_IDENTITY_PASSWORD ?? "").trim();

  if (!tenantKey || !userId) {
    throw new Error("Both --tenant <tenantKey> and --user <userId> are required.");
  }
  if (!newPassword) {
    throw new Error("RESET_IDENTITY_PASSWORD env var is required (the new plaintext password).");
  }

  const databaseUrl = String(
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "",
  ).trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_DIRECT or DATABASE_URL_POOLED or DATABASE_URL is required.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const existing = await prisma.authIdentity.findFirst({
      where: { tenantKey, userId },
      select: { id: true, tenantKey: true, userId: true },
    });
    if (!existing) {
      throw new Error(`No AuthIdentity found for tenantKey=${tenantKey} userId=${userId}.`);
    }

    const updated = await prisma.authIdentity.updateMany({
      where: { id: existing.id, tenantKey, userId },
      data: { passwordHash },
    });
    if (updated.count !== 1) {
      throw new Error(`Expected to update exactly 1 identity, updated ${updated.count}.`);
    }

    console.log(
      JSON.stringify(
        { status: "ok", tenantKey, userId, identityId: existing.id, checkedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
