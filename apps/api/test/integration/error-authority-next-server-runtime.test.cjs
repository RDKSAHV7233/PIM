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

const { NextServerErrorIngestController } = require("../../src/error-authority/next-server-ingest.controller");
const { ErrorCaptureService } = require("../../src/error-authority/error-capture.service");
const { ObservabilityDbService } = require("../../src/error-authority/observability-db.service");

const databaseUrl = String(process.env.OBSERVABILITY_DATABASE_URL ?? "").trim();
const refSecret = String(process.env.ERROR_AUTHORITY_REF_SECRET ?? "0123456789abcdef0123456789abcdef").trim();
const serviceName = "vexa-pim-web";
const routeTemplate = "/err-04b/runtime-proof";
const sourceEventId = `next_server:err-04b-runtime-${Date.now()}`;

async function cleanup(prisma) {
  const issues = await prisma.errorIssue.findMany({
    where: { service: serviceName, occurrences: { some: { routeTemplate } } },
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

async function main() {
  if (!databaseUrl) {
    console.log("SKIP error authority next-server runtime contract: OBSERVABILITY_DATABASE_URL is not set.");
    return;
  }

  const previousEnv = { ...process.env };
  process.env.ERROR_AUTHORITY_ENABLED = "true";
  process.env.OBSERVABILITY_DATABASE_URL = databaseUrl;
  process.env.ERROR_AUTHORITY_REF_SECRET = refSecret;
  process.env.ERROR_AUTHORITY_INGEST_TOKEN = "trusted-error-authority-token-minimum-32";
  process.env.ERROR_AUTHORITY_RELEASE = "976ab94a9191e68800debe5b3ed312194f4b0451";
  process.env.APP_ENV = process.env.APP_ENV || "development";

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await cleanup(prisma);

  const logger = { info() {}, warn() {}, error() {} };
  const store = new ObservabilityDbService(logger);
  await store.onModuleInit();
  const capture = new ErrorCaptureService(store, logger);
  const controller = new NextServerErrorIngestController(capture);
  const payload = {
    sourceEventId,
    release: "976ab94a9191e68800debe5b3ed312194f4b0451",
    routeTemplate,
    method: "GET",
    statusCode: 500,
    requestId: "req-err-04b-runtime",
    errorName: "RuntimeRenderFailure",
    errorCode: "RuntimeRenderFailure",
    category: "rendering",
    severity: "p1",
    frames: [{ file: "/srv/apps/web/src/app/runtime-proof/page.tsx", functionName: "Page", line: 42 }],
    headers: { cookie: "secret-cookie" },
    body: { productContent: "must not persist" },
  };

  await controller.ingestNextServerError("trusted-error-authority-token-minimum-32", payload, { ip: "127.0.0.1", socket: {} });
  await controller.ingestNextServerError("trusted-error-authority-token-minimum-32", payload, { ip: "127.0.0.1", socket: {} });
  await store.onModuleDestroy();

  const issue = await prisma.errorIssue.findFirst({
    where: { service: serviceName, occurrences: { some: { routeTemplate } } },
    include: { occurrences: true },
  });
  assert(issue, "expected next_server issue to be persisted");
  assert(issue.runtime === "next_server", `unexpected issue runtime ${issue.runtime}`);
  assert(issue.service === serviceName, `unexpected issue service ${issue.service}`);
  assert(issue.occurrenceCount === 1, `sourceEventId idempotency failed; occurrenceCount=${issue.occurrenceCount}`);
  assert(issue.occurrences.length === 1, `expected one stored occurrence, got ${issue.occurrences.length}`);
  const occurrence = issue.occurrences[0];
  assert(occurrence.release === "976ab94a9191e68800debe5b3ed312194f4b0451", `unexpected release ${occurrence.release}`);
  assert(occurrence.routeTemplate === routeTemplate, `unexpected route ${occurrence.routeTemplate}`);
  assert(occurrence.method === "GET", `unexpected method ${occurrence.method}`);
  assert(occurrence.statusCode === 500, `unexpected status ${occurrence.statusCode}`);
  assert(occurrence.sourceEventId === sourceEventId, `unexpected sourceEventId ${occurrence.sourceEventId}`);
  assert(occurrence.safeMessage === "Unexpected Next.js server error", `unsafe message persisted: ${occurrence.safeMessage}`);
  assert(JSON.stringify(issue).includes("secret-cookie") === false, "cookie leaked into observability storage");
  assert(JSON.stringify(issue).includes("must not persist") === false, "body content leaked into observability storage");

  await cleanup(prisma);
  const remaining = await prisma.errorIssue.count({
    where: { service: serviceName, occurrences: { some: { routeTemplate } } },
  });
  await prisma.$disconnect();
  process.env = previousEnv;
  assert(remaining === 0, `cleanup failed; ${remaining} issue(s) remain`);
  console.log("Error authority next-server runtime contract checks passed.");
}

main().catch((error) => {
  console.error("Error Authority next-server runtime contract failed:");
  console.error(error);
  process.exit(1);
});
