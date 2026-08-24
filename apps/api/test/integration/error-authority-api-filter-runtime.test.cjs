const { spawnSync } = require("node:child_process");
const path = require("node:path");

function withSchema(databaseUrl, schema) {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.set("schema", schema);
    return parsed.toString();
  } catch {
    return "";
  }
}

function resolveDatabaseUrl() {
  const explicit = String(process.env.OBSERVABILITY_DATABASE_URL ?? "").trim();
  if (explicit) {
    return { url: explicit, provisionFromAppDatabase: false };
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    const appDatabaseUrl = String(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "").trim();
    const derived = withSchema(appDatabaseUrl, "observability");
    if (derived) {
      return { url: derived, provisionFromAppDatabase: true };
    }
  }
  return { url: "", provisionFromAppDatabase: false };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: path.resolve(__dirname, "../../../.."),
    encoding: "utf8",
    input: options.input,
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}: ${(result.stderr || result.stdout || "").slice(0, 1200)}`,
    );
  }
}

function provisionCiObservabilityDatabase(databaseUrl) {
  runCommand("npx", ["prisma", "db", "execute", "--schema", "packages/db/prisma/schema.prisma", "--stdin"], {
    input: "CREATE SCHEMA IF NOT EXISTS observability;",
  });
  runCommand("npx", ["prisma", "migrate", "deploy", "--schema", "packages/observability-db/prisma/schema.prisma"], {
    env: { ...process.env, OBSERVABILITY_DATABASE_URL: databaseUrl },
  });
}

const resolvedDatabase = resolveDatabaseUrl();
const databaseUrl = resolvedDatabase.url;
const refSecret = String(process.env.ERROR_AUTHORITY_REF_SECRET ?? "0123456789abcdef0123456789abcdef").trim();
const serviceName = "vexa-pim-api";
const routeTemplate = "/api/v1/runtime-filter/:id";

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

function createHost(request, response) {
  return {
    getType: () => "http",
    getArgByIndex: (index) => index === 0 ? request : response,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
}

async function waitForIssue(prisma) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const issue = await prisma.errorIssue.findFirst({
      where: { service: serviceName, occurrences: { some: { routeTemplate } } },
      include: { occurrences: true },
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
    console.log("SKIP error authority API filter runtime contract: OBSERVABILITY_DATABASE_URL is not set.");
    return;
  }
  const { BadRequestException } = require("@nestjs/common");
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
  const { ApiExceptionCaptureFilter } = require("../../src/error-authority/api-exception-capture.filter");
  const { ErrorCaptureService } = require("../../src/error-authority/error-capture.service");
  const { ObservabilityDbService } = require("../../src/error-authority/observability-db.service");

  if (resolvedDatabase.provisionFromAppDatabase) {
    provisionCiObservabilityDatabase(databaseUrl);
  }
  process.env.ERROR_AUTHORITY_ENABLED = "true";
  process.env.OBSERVABILITY_DATABASE_URL = databaseUrl;
  process.env.ERROR_AUTHORITY_REF_SECRET = refSecret;
  process.env.APP_ENV = process.env.APP_ENV || "development";

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await cleanup(prisma);

  const logger = { info() {}, warn() {}, error() {} };
  const store = new ObservabilityDbService(logger);
  await store.onModuleInit();
  const capture = new ErrorCaptureService(store, logger);
  const reply = () => undefined;
  const filter = new ApiExceptionCaptureFilter(capture, {
    httpAdapter: {
      reply,
      isHeadersSent: () => false,
    },
  });
  const request = {
    method: "GET",
    baseUrl: "/api/v1/runtime-filter",
    route: { path: "/:id" },
    pimUserId: "runtime-filter-actor@example.com",
    pimAuthType: "user_jwt",
  };

  filter.catch(new Error("Runtime API boundary crash"), createHost(request, {}));
  filter.catch(new BadRequestException({ error: "EXPECTED_VALIDATION" }), createHost(request, {}));

  const issue = await waitForIssue(prisma);
  await store.onModuleDestroy();
  assert(issue, "expected API filter to capture unexpected error");
  assert(issue.occurrenceCount === 1, `expected one captured occurrence, got ${issue.occurrenceCount}`);
  assert(issue.occurrences.length === 1, `expected one stored occurrence, got ${issue.occurrences.length}`);
  assert(issue.occurrences[0].routeTemplate === routeTemplate, `unexpected routeTemplate ${issue.occurrences[0].routeTemplate}`);
  assert(issue.occurrences[0].method === "GET", `unexpected method ${issue.occurrences[0].method}`);
  assert(issue.occurrences[0].statusCode === 500, `unexpected statusCode ${issue.occurrences[0].statusCode}`);
  assert(issue.occurrences[0].safeActorRef, "expected safe actor ref");
  await cleanup(prisma);
  const remaining = await prisma.errorIssue.count({
    where: { service: serviceName, occurrences: { some: { routeTemplate } } },
  });
  await prisma.$disconnect();
  assert(remaining === 0, `cleanup failed; ${remaining} issue(s) remain`);
  console.log("Error authority API filter runtime contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
