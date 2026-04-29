#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const APP_ROLES = ["viewer", "reviewer", "editor", "admin"];
const REPO_ROOT = path.resolve(__dirname, "..");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    confirm: false,
    rollback: false,
    tenant: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "").trim();
    switch (token) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--confirm":
        args.confirm = true;
        break;
      case "--rollback":
        args.rollback = true;
        break;
      case "--tenant":
        args.tenant = String(argv[i + 1] ?? "").trim() || null;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.dryRun && !args.confirm) {
    args.dryRun = true;
  }
  if (args.dryRun && args.confirm) {
    throw new Error("Use either --dry-run or --confirm, not both.");
  }
  return args;
}

function normalizeAppRole(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return APP_ROLES.includes(normalized) ? normalized : null;
}

function normalizeAssignedRoles(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function classifyCandidate(row, rollback) {
  const role = normalizeAppRole(row.role);
  const normalizedAssignedRoles = normalizeAssignedRoles(row.assignedRoles);
  const isNullAssignedRoles = row.assignedRoles === null || row.assignedRoles === undefined;
  const isEmptyAssignedRoles = Array.isArray(normalizedAssignedRoles) && normalizedAssignedRoles.length === 0;

  if (!role) {
    return {
      eligible: false,
      reason: "invalid_scalar_role",
      nextAssignedRoles: normalizedAssignedRoles,
      role: null,
    };
  }

  if (rollback) {
    if (Array.isArray(normalizedAssignedRoles) && arraysEqual(normalizedAssignedRoles, [role])) {
      return {
        eligible: true,
        reason: "rollback_scalar_singleton",
        nextAssignedRoles: [],
        role,
      };
    }
    return {
      eligible: false,
      reason: "rollback_skip_non_scalar_singleton",
      nextAssignedRoles: normalizedAssignedRoles,
      role,
    };
  }

  if (isNullAssignedRoles || isEmptyAssignedRoles) {
    return {
      eligible: true,
      reason: isNullAssignedRoles ? "backfill_null_assigned_roles" : "backfill_empty_assigned_roles",
      nextAssignedRoles: [role],
      role,
    };
  }

  return {
    eligible: false,
    reason: "backfill_skip_existing_assigned_roles",
    nextAssignedRoles: normalizedAssignedRoles,
    role,
  };
}

async function collectAssignedRolesRolloutPlan(prisma, options = {}) {
  const where = options.tenant ? { tenantKey: options.tenant } : undefined;
  const rows = await prisma.authIdentity.findMany({
    where,
    orderBy: [{ tenantKey: "asc" }, { userId: "asc" }],
    select: {
      id: true,
      tenantKey: true,
      userId: true,
      role: true,
      assignedRoles: true,
    },
  });

  const candidates = rows.map((row) => {
    const classification = classifyCandidate(row, Boolean(options.rollback));
    return {
      id: row.id,
      tenantKey: row.tenantKey,
      userId: row.userId,
      role: row.role,
      currentAssignedRoles: normalizeAssignedRoles(row.assignedRoles),
      assignedRolesWasNull: row.assignedRoles === null || row.assignedRoles === undefined,
      eligible: classification.eligible,
      reason: classification.reason,
      nextAssignedRoles: classification.nextAssignedRoles,
    };
  });

  const eligible = candidates.filter((candidate) => candidate.eligible);
  const invalidScalarRoleCount = candidates.filter((candidate) => candidate.reason === "invalid_scalar_role").length;
  const skippedExistingAssignedRolesCount = candidates.filter(
    (candidate) => candidate.reason === "backfill_skip_existing_assigned_roles",
  ).length;
  const skippedUnsafeRollbackCount = candidates.filter(
    (candidate) => candidate.reason === "rollback_skip_non_scalar_singleton",
  ).length;

  return {
    mode: options.rollback ? "rollback" : "backfill",
    tenant: options.tenant ?? null,
    scannedCount: candidates.length,
    eligibleCount: eligible.length,
    invalidScalarRoleCount,
    skippedExistingAssignedRolesCount,
    skippedUnsafeRollbackCount,
    candidates,
  };
}

async function executeAssignedRolesRollout(prisma, options = {}) {
  const plan = await collectAssignedRolesRolloutPlan(prisma, options);
  if (options.dryRun) {
    return {
      ...plan,
      dryRun: true,
      updatedCount: 0,
      updatedUserIds: [],
    };
  }

  const updatedUserIds = [];
  await prisma.$transaction(async (tx) => {
    for (const candidate of plan.candidates) {
      if (!candidate.eligible) {
        continue;
      }
      await tx.authIdentity.update({
        where: { id: candidate.id },
        data: { assignedRoles: candidate.nextAssignedRoles ?? [] },
      });
      updatedUserIds.push(candidate.userId);
    }
  });

  return {
    ...plan,
    dryRun: false,
    updatedCount: updatedUserIds.length,
    updatedUserIds,
  };
}

function createPrisma() {
  prepareEnv();
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

async function main() {
  const args = parseArgs(process.argv);
  const prisma = createPrisma();
  try {
    const result = await executeAssignedRolesRollout(prisma, {
      tenant: args.tenant,
      rollback: args.rollback,
      dryRun: args.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  normalizeAppRole,
  normalizeAssignedRoles,
  classifyCandidate,
  collectAssignedRolesRolloutPlan,
  executeAssignedRolesRollout,
  createPrisma,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
