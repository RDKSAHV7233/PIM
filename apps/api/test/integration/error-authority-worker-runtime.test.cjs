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
const { QueueService } = require("../../src/queue/queue.service");

const databaseUrl = String(process.env.OBSERVABILITY_DATABASE_URL ?? "").trim();
const refSecret = String(process.env.ERROR_AUTHORITY_REF_SECRET ?? "0123456789abcdef0123456789abcdef").trim();
const routeTemplate = "queue:bulk-import:default";

async function cleanup(prisma) {
  const issues = await prisma.errorIssue.findMany({
    where: { service: "vexa-pim-api", occurrences: { some: { routeTemplate } } },
    select: { id: true },
  });
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

async function waitForIssue(prisma) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const issue = await prisma.errorIssue.findFirst({
      where: { service: "vexa-pim-api", occurrences: { some: { routeTemplate } } },
      include: { occurrences: true, tenantImpacts: true },
    });
    if (issue) {
      return issue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function main() {
  if (!databaseUrl) {
    console.log("SKIP error authority worker runtime contract: OBSERVABILITY_DATABASE_URL is not set.");
    return;
  }
  process.env.ERROR_AUTHORITY_ENABLED = "true";
  process.env.OBSERVABILITY_DATABASE_URL = databaseUrl;
  process.env.ERROR_AUTHORITY_REF_SECRET = refSecret;
  process.env.APP_ENV = process.env.APP_ENV || "development";
  process.env.QUEUE_BACKEND = "memory";
  process.env.QUEUE_WORKER_ENABLED = "true";

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await cleanup(prisma);

  const logger = { info() {}, warn() {}, error() {} };
  const store = new ObservabilityDbService(logger);
  await store.onModuleInit();
  const capture = new ErrorCaptureService(store, logger);
  const queue = new QueueService(capture);

  queue.process("bulk-import", async (payload) => {
    if (payload && payload.expected) {
      throw new Error("Marketplace validation rejection");
    }
    throw new Error("Unexpected worker database crash");
  });

  await queue.enqueue("bulk-import", {
    tenantKey: "worker-runtime-tenant",
    jobId: "worker-runtime-job",
    operationId: "worker-runtime-operation",
    installationId: "worker-runtime-installation",
    rawPayload: "must-not-be-stored",
  });
  await queue.enqueue("bulk-import", {
    tenantKey: "worker-runtime-tenant",
    jobId: "worker-runtime-expected",
    expected: true,
  });

  const issue = await waitForIssue(prisma);
  await store.onModuleDestroy();
  assert(issue, "expected worker failure to be captured");
  assert(issue.occurrenceCount === 1, `expected one worker occurrence, got ${issue.occurrenceCount}`);
  assert(issue.occurrences.length === 1, `expected one stored worker occurrence, got ${issue.occurrences.length}`);
  const occurrence = issue.occurrences[0];
  assert(occurrence.runtime === "worker", `unexpected runtime ${occurrence.runtime}`);
  assert(occurrence.routeTemplate === routeTemplate, `unexpected routeTemplate ${occurrence.routeTemplate}`);
  assert(occurrence.jobId === "worker-runtime-job", `unexpected jobId ${occurrence.jobId}`);
  assert(occurrence.operationId === "worker-runtime-operation", `unexpected operationId ${occurrence.operationId}`);
  assert(occurrence.installationId === "worker-runtime-installation", `unexpected installationId ${occurrence.installationId}`);
  assert(occurrence.safeTenantRef, "expected safe tenant ref");
  assert(!JSON.stringify(occurrence).includes("must-not-be-stored"), "raw payload leaked into worker occurrence");
  await cleanup(prisma);
  const remaining = await prisma.errorIssue.count({
    where: { service: "vexa-pim-api", occurrences: { some: { routeTemplate } } },
  });
  await prisma.$disconnect();
  assert(remaining === 0, `cleanup failed; ${remaining} issue(s) remain`);
  console.log("Error authority worker runtime contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
