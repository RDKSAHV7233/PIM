const { PrismaClient } = require("@pim1/observability-db/generated/client");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "CommonJS",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    types: ["node"],
  },
});

const { ErrorCaptureService } = require("../../src/error-authority/error-capture.service");
const { ObservabilityDbService } = require("../../src/error-authority/observability-db.service");

const databaseUrl = String(process.env.OBSERVABILITY_DATABASE_URL ?? "").trim();
const refSecret = String(process.env.ERROR_AUTHORITY_REF_SECRET ?? "0123456789abcdef0123456789abcdef").trim();
const serviceName = "vexa-pim-api-runtime-contract";

async function cleanup(prisma) {
  const issues = await prisma.errorIssue.findMany({ where: { service: serviceName }, select: { id: true } });
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.length === 0) {
    return;
  }
  await prisma.errorIssueTenantImpact.deleteMany({ where: { issueId: { in: issueIds } } });
  await prisma.errorOccurrence.deleteMany({ where: { issueId: { in: issueIds } } });
  await prisma.errorIssue.deleteMany({ where: { id: { in: issueIds } } });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  if (!databaseUrl) {
    console.log("SKIP error authority runtime contract: OBSERVABILITY_DATABASE_URL is not set.");
    return;
  }
  process.env.ERROR_AUTHORITY_ENABLED = "true";
  process.env.OBSERVABILITY_DATABASE_URL = databaseUrl;
  process.env.ERROR_AUTHORITY_REF_SECRET = refSecret;
  process.env.APP_ENV = process.env.APP_ENV || "development";

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await cleanup(prisma);
  await prisma.$disconnect();

  const logger = {
    info() {},
    warn(message, meta) {
      console.warn(JSON.stringify({ level: "warn", message, meta }));
    },
    error(message, meta) {
      console.error(JSON.stringify({ level: "error", message, meta }));
    },
  };
  const store = new ObservabilityDbService(logger);
  await store.onModuleInit();
  const capture = new ErrorCaptureService(store, logger);
  const base = {
    runtime: "api",
    service: serviceName,
    environment: "development",
    routeTemplate: "/api/v1/runtime-contract/:id",
    rawTenantKey: "runtime-tenant",
    rawActorId: "runtime-actor@example.com",
    actorType: "human",
    frames: [{ file: "/srv/apps/api/src/runtime-contract.service.ts", functionName: "capture", line: 19 }],
  };

  await capture.captureWithStore(
    { ...base, sourceEventId: "runtime-contract-1", release: "runtime-a", error: new Error("Runtime product cm111111111111 failed token=secret-one") },
    store,
  );
  await capture.captureWithStore(
    { ...base, sourceEventId: "runtime-contract-2", release: "runtime-b", error: new Error("Runtime product cm222222222222 failed token=secret-two") },
    store,
  );
  await capture.captureWithStore(
    { ...base, sourceEventId: "runtime-contract-2", release: "runtime-b", error: new Error("Runtime product cm222222222222 failed token=secret-two") },
    store,
  );
  await store.onModuleDestroy();

  const verify = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const issues = await verify.errorIssue.findMany({
    where: { service: serviceName },
    include: { occurrences: true, tenantImpacts: true },
  });
  assert(issues.length === 1, `expected 1 issue, got ${issues.length}`);
  const issue = issues[0];
  assert(issue.occurrenceCount === 2, `expected occurrenceCount 2, got ${issue.occurrenceCount}`);
  assert(issue.occurrences.length === 2, `expected 2 occurrences, got ${issue.occurrences.length}`);
  assert(issue.affectedTenantCount === 1, `expected affectedTenantCount 1, got ${issue.affectedTenantCount}`);
  assert(issue.tenantImpacts.length === 1, `expected 1 tenant impact, got ${issue.tenantImpacts.length}`);
  assert(issue.firstSeenRelease === "runtime-a", `expected firstSeenRelease runtime-a, got ${issue.firstSeenRelease}`);
  assert(issue.lastSeenRelease === "runtime-b", `expected lastSeenRelease runtime-b, got ${issue.lastSeenRelease}`);
  assert(issue.occurrences.every((occurrence) => !occurrence.safeMessage.includes("secret")), "secret leaked into safeMessage");
  assert(issue.occurrences.every((occurrence) => occurrence.safeTenantRef && occurrence.safeActorRef), "safe refs missing");
  await cleanup(verify);
  const remaining = await verify.errorIssue.count({ where: { service: serviceName } });
  await verify.$disconnect();
  assert(remaining === 0, `cleanup failed; ${remaining} issue(s) remain`);
  console.log("Error authority runtime contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
