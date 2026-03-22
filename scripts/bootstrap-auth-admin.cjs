#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
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

function resolveBootstrapPassword(args) {
  const direct = String(args.password ?? '').trim();
  if (direct) {
    return direct;
  }
  const envPassword = String(process.env.PIM_BOOTSTRAP_PASSWORD ?? process.env.PIM_AUTH_PASSWORD ?? '').trim();
  if (envPassword) {
    return envPassword;
  }
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  if (appEnv === 'development' || appEnv === 'local' || appEnv === 'test') {
    return 'pim1-demo-password';
  }
  throw new Error('Missing bootstrap password. Pass --password <value> or set PIM_BOOTSTRAP_PASSWORD.');
}

async function main() {
  const args = parseArgs(process.argv);
  const userId = String(args.userId ?? '').trim().toLowerCase();
  const tenantKey = String(args.tenantKey ?? 'default').trim() || 'default';
  const role = normalizeRole(args.role ?? 'admin');
  const createdBy = String(args.createdBy ?? 'bootstrap-script').trim() || 'bootstrap-script';
  const password = resolveBootstrapPassword(args);
  const passwordHash = await bcrypt.hash(password, 12);

  if (!userId) {
    throw new Error('Missing --userId <value>');
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRaw`
      INSERT INTO "AuthIdentity" (
        "id", "tenantKey", "userId", "role", "isActive", "passwordHash", "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${`authid_${randomUUID()}`}, ${tenantKey}, ${userId}, ${role}, true, ${passwordHash}, ${createdBy}, NOW(), NOW()
      )
      ON CONFLICT ("userId")
      DO UPDATE SET
        "tenantKey" = EXCLUDED."tenantKey",
        "role" = EXCLUDED."role",
        "isActive" = true,
        "passwordHash" = EXCLUDED."passwordHash",
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
