#!/usr/bin/env node
/* eslint-disable no-console */
// Resets ONE specific, explicitly-identified AuthIdentity's password hash to a
// given plaintext password. Unlike migrate-legacy-auth-password-hashes.cjs
// (which only ever touches identities with passwordHash: null), this performs
// an unconditional reset — used after rotating a shared credential to bring a
// named maintenance/smoke-test identity's actual stored credential back in
// sync. Requires explicit --tenant and --user; refuses to run without both,
// so it can never accidentally match more than one identity.
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
