#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '').trim();
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = String(argv[i + 1] ?? '').trim();
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      i -= 1;
      continue;
    }
    args[key] = value;
  }
  return args;
}

function normalizeRole(input) {
  const value = String(input ?? '').trim().toLowerCase();
  if (value === 'admin' || value === 'editor' || value === 'viewer') {
    return value;
  }
  throw new Error('Invalid role. Use one of: admin, editor, viewer');
}

async function main() {
  const args = parseArgs(process.argv);
  const userId = String(args.userId ?? '').trim().toLowerCase();
  const tenantKey = String(args.tenantKey ?? 'default').trim() || 'default';
  const role = normalizeRole(args.role ?? 'admin');
  const createdBy = String(args.createdBy ?? 'bootstrap-script').trim() || 'bootstrap-script';

  if (!userId) {
    throw new Error('Missing --userId <value>');
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRaw`
      INSERT INTO "AuthIdentity" (
        "id", "tenantKey", "userId", "role", "isActive", "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${`authid_${randomUUID()}`}, ${tenantKey}, ${userId}, ${role}, true, ${createdBy}, NOW(), NOW()
      )
      ON CONFLICT ("userId")
      DO UPDATE SET
        "tenantKey" = EXCLUDED."tenantKey",
        "role" = EXCLUDED."role",
        "isActive" = true,
        "createdBy" = EXCLUDED."createdBy",
        "updatedAt" = NOW()
    `;

    const rows = await prisma.$queryRaw`
      SELECT "userId", "tenantKey", "role", "isActive"
      FROM "AuthIdentity"
      WHERE "userId" = ${userId}
      LIMIT 1
    `;

    console.log(JSON.stringify({ status: 'ok', identity: rows[0] ?? null }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
