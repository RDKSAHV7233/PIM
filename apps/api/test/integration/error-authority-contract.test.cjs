const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../../..");
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const schema = read("packages/observability-db/prisma/schema.prisma");
const migration = read("packages/observability-db/prisma/migrations/20260803000000_error_authority_foundation/migration.sql");
const appModule = read("apps/api/src/app.module.ts");
const envValidation = read("apps/api/src/common/env-validation.ts");
const moduleSource = read("apps/api/src/error-authority/error-authority.module.ts");
const apiFilter = read("apps/api/src/error-authority/api-exception-capture.filter.ts");
const nextServerIngest = read("apps/api/src/error-authority/next-server-ingest.controller.ts");
const workerClassifier = read("apps/api/src/error-authority/worker-error-classifier.ts");
const captureService = read("apps/api/src/error-authority/error-capture.service.ts");
const storageService = read("apps/api/src/error-authority/observability-db.service.ts");
const queueService = read("apps/api/src/queue/queue.service.ts");
const releaseHelper = read("apps/api/src/common/error-authority-env.ts");

assert(
  schema.includes('url      = env("OBSERVABILITY_DATABASE_URL")') &&
    !schema.includes("tenantKey") &&
    schema.includes("model ErrorIssue") &&
    schema.includes("model ErrorOccurrence") &&
    schema.includes("model ErrorIssueTenantImpact"),
  "Error authority must use a separate observability Prisma schema without tenant-scoped app models.",
);

assert(
  schema.includes("@@unique([environment, runtime, service, fingerprintVersion, fingerprint]") &&
    schema.includes("sourceEventId    String?") &&
    schema.includes("@unique @map(\"source_event_id\")") &&
    schema.includes("firstSeenRelease") &&
    schema.includes("lastSeenRelease"),
  "Error authority schema must include grouping uniqueness, source-event idempotency, and release-safe issue fields.",
);

assert(
  migration.includes('CREATE TABLE "error_issues"') &&
    migration.includes('CREATE TABLE "error_occurrences"') &&
    migration.includes('CREATE TABLE "error_issue_tenant_impacts"') &&
    migration.includes('CREATE UNIQUE INDEX "error_issues_group_unique"') &&
    migration.includes('CREATE UNIQUE INDEX "error_occurrences_source_event_id_key"'),
  "Error authority foundation must include a separate observability database migration.",
);

assert(
  appModule.includes("ErrorAuthorityModule") &&
    moduleSource.includes("APP_FILTER") &&
    moduleSource.includes("ApiExceptionCaptureFilter") &&
    envValidation.includes("ERROR_AUTHORITY_ENABLED") &&
    envValidation.includes("ERROR_AUTHORITY_RELEASE") &&
    envValidation.includes("ERROR_AUTHORITY_INGEST_TOKEN") &&
    envValidation.includes("OBSERVABILITY_DATABASE_URL") &&
    envValidation.includes("ERROR_AUTHORITY_REF_SECRET"),
  "API must register the error authority foundation with disabled-by-default configuration.",
);

assert(
  releaseHelper.includes("resolveErrorAuthorityRelease") &&
    releaseHelper.includes("ERROR_AUTHORITY_LOCAL_RELEASE") &&
    releaseHelper.includes("must not be a timestamp-only value") &&
    captureService.includes("resolveErrorAuthorityRelease()"),
  "Error authority capture must use a deterministic server-side release accessor and reject floating release identifiers in strict environments.",
);

assert(
  apiFilter.includes("BaseExceptionFilter") &&
    apiFilter.includes("shouldCaptureApiException") &&
    apiFilter.includes("EXPECTED_HTTP_STATUSES") &&
    apiFilter.includes("super.catch(exception, host)") &&
    apiFilter.includes("resolveRouteTemplate") &&
    !apiFilter.includes("request.body") &&
    !apiFilter.includes("request.headers.cookie") &&
    !apiFilter.includes("authorization"),
  "API exception capture must preserve Nest response handling, exclude expected HTTP statuses, and avoid raw request data.",
);

assert(
  captureService.includes("failed open") &&
    storageService.includes("capture failed open") &&
    storageService.includes("errorIssue.upsert") &&
    storageService.includes("errorOccurrence.findUnique") &&
    storageService.includes("sourceEventId"),
  "Error capture must be fail-open, idempotent, and use atomic issue upsert semantics.",
);

assert(
  storageService.includes('select: { id: true, severity: true, state: true }') &&
    storageService.includes('...(existingIssue?.state === "resolved" ? { state: "open" } : {})') &&
    !storageService.includes('...(existingIssue?.state !== "open" ? { state: "open" } : {})'),
  "Error authority must reopen resolved issues on recurrence without silently unmuting muted issues.",
);

assert(
  storageService.includes("resolveInactiveOpenIssues") &&
    storageService.includes('state: "open"') &&
    storageService.includes('state: "resolved"') &&
    storageService.includes('updatedAt: { lt: cutoff }') &&
    storageService.includes("muted issue is not resolved and") &&
    storageService.includes("remains visible as resolved for one retention window"),
  "Error authority retention must resolve stale open issues, exempt muted issues, and purge only resolved issues after a retention window.",
);

assert(
  moduleSource.includes("NextServerErrorIngestController") &&
    nextServerIngest.includes('@Controller("error-authority")') &&
    nextServerIngest.includes("ApiExcludeEndpoint") &&
    nextServerIngest.includes('@Post("ingest/next-server")') &&
    nextServerIngest.includes("ERROR_AUTHORITY_INGEST_TOKEN") &&
    nextServerIngest.includes('runtime: "next_server"') &&
    nextServerIngest.includes('service: "vexa-pim-web"') &&
    nextServerIngest.includes("sourceEventId") &&
    nextServerIngest.includes("Unexpected Next.js server error") &&
    !nextServerIngest.includes("request.body") &&
    !nextServerIngest.includes("request.headers") &&
    !nextServerIngest.includes('@Headers("authorization")') &&
    !nextServerIngest.includes("@Headers('authorization')"),
  "Next server trusted ingestion must require the ingest token, use canonical ErrorCaptureService, preserve sourceEventId, and avoid raw request data.",
);

assert(
  queueService.includes("captureTerminalWorkerFailure") &&
    queueService.includes('runtime: "worker"') &&
    queueService.includes("created.worker.on(\"failed\"") &&
    queueService.includes("isTerminalBullFailure") &&
    queueService.includes("extractSafePayloadRef") &&
    workerClassifier.includes("EXPECTED_WORKER_ERROR_PATTERNS") &&
    !queueService.includes("rawPayload"),
  "Worker capture must happen at terminal queue boundaries, exclude expected domain failures, and avoid raw payload forwarding.",
);

assert(
  !storageService.includes("cookies") &&
    !storageService.includes("payloadSnapshot") &&
    !storageService.includes("request body"),
  "Error authority storage foundation must not persist prohibited raw request, cookie, or connector payload data.",
);

console.log("Error authority foundation contract checks passed.");
