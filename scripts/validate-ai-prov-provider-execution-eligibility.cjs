#!/usr/bin/env node

/**
 * AI-PROV-004a / 004b-i: static guard for the provider execution control plane.
 *
 * Proves, from source, that the control plane stays controls-only and fail-closed: default-deny schema and migration,
 * BIGINT money, one fixed counter lock order, compare-and-set transitions, no provider SDK, network call, credential or
 * Product mutation, no caller, and platform tables written only by operators. The runtime proof lives in
 * apps/api/test/integration/ai-provider-budget-lifecycle.test.cjs (real PostgreSQL).
 *
 * `validateProviderExecutionEligibility(transforms, extra)` accepts per-source text transforms and an extra governed
 * source string so the negative tests can prove each rule actually fires.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const INTELLIGENCE_DIR = path.join(REPO_ROOT, "apps", "api", "src", "intelligence");
const API_SRC = path.join(REPO_ROOT, "apps", "api", "src");
const MIGRATIONS = path.join(REPO_ROOT, "packages", "db", "prisma", "migrations");

const FILES = {
  schema: path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma"),
  migration004a: path.join(MIGRATIONS, "20261005003000_ai_provider_budget_controls", "migration.sql"),
  migration004b: path.join(MIGRATIONS, "20261005120000_ai_provider_budget_lifecycle", "migration.sql"),
  control: path.join(INTELLIGENCE_DIR, "intelligence-execution-control.service.ts"),
  gates: path.join(INTELLIGENCE_DIR, "intelligence-execution-gates.ts"),
  money: path.join(INTELLIGENCE_DIR, "intelligence-money.ts"),
  maintenance: path.join(INTELLIGENCE_DIR, "intelligence-reservation-maintenance.service.ts"),
  types: path.join(INTELLIGENCE_DIR, "intelligence.types.ts"),
  tenantScope: path.join(API_SRC, "prisma", "extensions", "tenant-scope.ts"),
  integration: path.join(REPO_ROOT, "apps", "api", "test", "integration", "ai-provider-budget-lifecycle.test.cjs"),
  packageJson: path.join(REPO_ROOT, "package.json"),
  ci: path.join(REPO_ROOT, ".github", "workflows", "ci.yml"),
};

const ALLOWED_ENV_READS = new Map([
  [path.join(INTELLIGENCE_DIR, "intelligence-execution-gates.ts"), new Set(["process.env"])],
  [path.join(INTELLIGENCE_DIR, "intelligence-reservation-maintenance.service.ts"), new Set(["process.env.AI_RESERVATION_SWEEP_DISABLED"])],
]);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, label, message) {
  errors.push(`${label}: ${message}`);
}

/** Source without comments, so a comment that explains a retired mechanism is not mistaken for using it. */
function stripComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listSourceFiles(rootDir, { includeSpecs = false } = {}) {
  const files = [];
  function visit(current) {
    if (!fs.existsSync(current)) {
      return;
    }
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(current)) {
        if (child === "node_modules" || child === "dist") {
          continue;
        }
        visit(path.join(current, child));
      }
      return;
    }
    if (/\.(ts|tsx|js|cjs|mjs)$/.test(current) && (includeSpecs || !/\.spec\.ts$/.test(current))) {
      files.push(current);
    }
  }
  visit(rootDir);
  return files;
}

function modelBlock(schema, name) {
  const match = new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`).exec(schema);
  return match ? match[0] : "";
}

function validateProviderExecutionEligibility(transforms = {}, extraGoverned = "") {
  const errors = [];
  const src = {};
  for (const [key, file] of Object.entries(FILES)) {
    src[key] = read(file);
    if (transforms[key]) {
      src[key] = transforms[key](src[key]);
    }
  }
  const governedFiles = listSourceFiles(INTELLIGENCE_DIR);
  const governedSource = governedFiles.map(read).join("\n") + "\n" + extraGoverned;

  // ---- schema ---------------------------------------------------------------------------------------------------
  for (const modelName of ["AiProviderBudgetPolicy", "AiProviderBudgetReservation", "AiProviderBudgetCharge", "AiPlatformControl", "AiPlatformBudgetPeriod"]) {
    if (!src.schema.includes(`model ${modelName} `)) {
      fail(errors, "schema", `must define ${modelName}`);
    }
  }
  for (const modelName of ["AiExecution", "AiProviderBudgetPolicy", "AiProviderBudgetReservation", "AiProviderBudgetCharge", "AiPlatformControl", "AiPlatformBudgetPeriod"]) {
    if (/Micros\s+Int\b/.test(modelBlock(src.schema, modelName))) {
      fail(errors, "schema.money", `${modelName} must store micros as BigInt, never Int`);
    }
  }

  // ---- 004a migration (still the creator of the budget tables) ---------------------------------------------------
  for (const tableName of ["ai_provider_budget_policies", "ai_provider_budget_reservations"]) {
    if (!src.migration004a.includes(`CREATE TABLE "${tableName}"`)) {
      fail(errors, "migration004a", `must create ${tableName}`);
    }
    if (!src.migration004a.includes(`ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY`)) {
      fail(errors, "migration004a", `${tableName} must force RLS`);
    }
  }

  // ---- 004b-i migration ------------------------------------------------------------------------------------------
  const m = src.migration004b;
  for (const column of [
    "spend_limit_micros",
    "reserved_spend_micros",
    "spent_spend_micros",
    "requested_estimated_cost_micros",
    "reserved_cost_micros",
    "actual_cost_micros",
    "estimated_cost_micros",
  ]) {
    if (!new RegExp(`ALTER COLUMN "${column}" TYPE BIGINT`).test(m)) {
      fail(errors, "migration004b", `must widen ${column} to BIGINT`);
    }
  }
  if (!/spend_limit_micros" <= 1000000000000/.test(m)) {
    fail(errors, "migration004b", "must cap spend limits at the USD 1,000,000 sanity ceiling");
  }
  for (const status of ["reserved", "dispatching", "reconciled", "cancelled", "expired", "budget_blocked"]) {
    if (!new RegExp(`'${status}'`).test(m)) {
      fail(errors, "migration004b", `reservation status set must include ${status}`);
    }
  }
  if (!/"tenant_key", "request_fingerprint", "attempt_number"/.test(m)) {
    fail(errors, "migration004b", "reservation key must be (tenant, fingerprint, attempt)");
  }
  if (!m.includes('ALTER TABLE "ai_provider_budget_charges" FORCE ROW LEVEL SECURITY') || !m.includes("tenant_isolation_ai_provider_budget_charges")) {
    fail(errors, "migration004b", "charges must force RLS and carry a tenant isolation policy");
  }
  if (!/"enabled" BOOLEAN NOT NULL DEFAULT false/.test(m) || !/"kill_switch" BOOLEAN NOT NULL DEFAULT true/.test(m)) {
    fail(errors, "migration004b", "platform control must default disabled with the kill switch on");
  }
  if (!/"max_request_cost_micros" BIGINT NOT NULL DEFAULT 0/.test(m) || !/"spend_limit_micros" BIGINT NOT NULL DEFAULT 0/.test(m)) {
    fail(errors, "migration004b", "every limit must default to zero");
  }
  if (!/"allowed_tenant_keys" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/.test(m)) {
    fail(errors, "migration004b", "the tenant allow-list must default to empty");
  }
  if (!/INSERT INTO "ai_platform_controls" \("id"\) VALUES \('global'\)/.test(m)) {
    fail(errors, "migration004b", "must seed exactly the default-deny platform control row");
  }
  if (/INSERT INTO "ai_platform_budget_periods"|INSERT INTO "ai_provider_budget_policies"/.test(m)) {
    fail(errors, "migration004b", "must not seed any budget row: a missing row denies");
  }
  if (/_micros"[^\n]*DEFAULT [1-9]/.test(m)) {
    fail(errors, "migration004b", "no money column may have a non-zero default");
  }

  // explicit, read-only maintenance path for the sweeper and the audit
  const maintenanceSelectOnly = m.includes("FOR SELECT USING (current_setting(''app.ai_maintenance'', true) = ''on'')");
  const maintenanceWrites = /FOR (ALL|INSERT|UPDATE|DELETE)[^;]*app[.]ai_maintenance/.test(m);
  if (!maintenanceSelectOnly || maintenanceWrites) {
    fail(errors, "migration004b.maintenance", "the maintenance marker may grant SELECT only, never INSERT, UPDATE, DELETE or ALL");
  }
  for (const table of ["ai_provider_budget_policies", "ai_provider_budget_reservations", "ai_provider_budget_charges"]) {
    if (!m.includes(`'${table}'`)) {
      fail(errors, "migration004b.maintenance", `the read-only maintenance policy must cover ${table}`);
    }
  }
  // SEC-DB-RLS-001 (evidence record D-022): the ordinary runtime can set any session setting, so a policy that opens on a
  // setting is not a separately governed path. The sweeper and the audit reach every tenant by explicit tenant iteration
  // (forEachTenant: one transaction per tenant, tenant context set inside it) and never set or read the marker. The policies
  // are dropped by a later migration, after this code is deployed; until then this only forbids USING them.
  const maintenanceCode = stripComments(src.maintenance);
  if (/app[.]ai_maintenance|set_config\s*\(|withMaintenanceRead/.test(maintenanceCode)) {
    fail(errors, "maintenance.marker", "the sweeper and audit must not set or read the maintenance marker: cross-tenant reads go through explicit tenant iteration (forEachTenant)");
  }
  if (!/forEachTenant\s*\(/.test(maintenanceCode)) {
    fail(errors, "maintenance.iteration", "the sweeper and audit must reach every tenant through forEachTenant (explicit tenant iteration)");
  }
  for (const file of governedFiles) {
    if (/app[.]ai_maintenance/.test(stripComments(read(file)))) {
      fail(errors, "maintenance.marker", `${path.relative(REPO_ROOT, file)} must not set or read the maintenance marker`);
    }
  }
  if (/app[.]ai_maintenance/.test(extraGoverned)) {
    fail(errors, "maintenance.marker", "extra source touches the maintenance marker");
  }
  if (!/NOSUPERUSER NOBYPASSRLS/.test(src.integration) || !/rolbypassrls/.test(src.integration)) {
    fail(errors, "integration.role", "the real-PostgreSQL test must run the services as a role that is neither superuser nor BYPASSRLS");
  }

  // ---- gates ------------------------------------------------------------------------------------------------------
  if (!/DEPLOY_FLAG_ENV = "FEATURE_INTELLIGENCE_PROVIDER_ENABLED"/.test(src.gates)) {
    fail(errors, "gates", "the deploy flag must be FEATURE_INTELLIGENCE_PROVIDER_ENABLED");
  }
  if (!/raw\.trim\(\)\.toLowerCase\(\) === "true"/.test(src.gates)) {
    fail(errors, "gates.flag", "the deploy flag must be ON only for the exact word true");
  }
  if (!/CHARGE_ORDER[^=]*=\s*\["platform_month", "platform_day", "tenant_month", "tenant_day"\]/.test(src.gates)) {
    fail(errors, "gates.order", "counters must be charged in the one fixed order: platform month, platform day, tenant month, tenant day");
  }
  for (const reason of ["platform_control_missing", "platform_kill_switch", "tenant_not_allowlisted", "provider_pin_mismatch", "request_cost_exceeded"]) {
    if (!src.gates.includes(`"${reason}"`)) {
      fail(errors, "gates", `must deny with ${reason}`);
    }
  }
  if (!/LIVE_PROVIDER_CAPABILITY_ALLOWLIST[^=]*=\s*\["[a-z_]+"\]/.test(src.gates)) {
    fail(errors, "gates", "the code-level live allow-list must name exactly one capability");
  }

  // ---- control service --------------------------------------------------------------------------------------------
  const c = src.control;
  if (!/if \(!this\.deployFlagEnabled\(\)\)/.test(c)) {
    fail(errors, "control.flag", "admission must deny unless the deploy flag is on");
  }
  if (c.indexOf("deployFlagEnabled()") > c.indexOf("readPlatformGate(parsed)")) {
    fail(errors, "control.order", "the deploy flag must be checked before any control is read");
  }
  if ((c.match(/for \(const scope of CHARGE_ORDER\)/g) ?? []).length < 2 || !/CHARGE_ORDER\.indexOf\(/.test(c)) {
    fail(errors, "control.lockOrder", "validation and charging must iterate CHARGE_ORDER, and settlement must sort its charges by it");
  }
  if (!/status: "reserved", expiresAt: \{ gt: now \}/.test(c)) {
    fail(errors, "control.claim", "the claim must be a compare-and-set on status reserved and an unexpired reservation");
  }
  if (!/status: \{ in: fromStatuses \}/.test(c)) {
    fail(errors, "control.settle", "settlement must be a compare-and-set on the current status");
  }
  if (!/OR: \[\{ status: "reserved" \}, \{ claimToken: ref\.claimToken \?\? "" \}\]/.test(c)) {
    fail(errors, "control.token", "leaving dispatching must require the claim token");
  }
  for (const required of ['"request_count" < "request_limit"', '"reserved_spend_micros" + "spent_spend_micros"', "RETURNING", "tx.$queryRaw"]) {
    if (!c.includes(required)) {
      fail(errors, "control.reserve", `must include ${required}`);
    }
  }
  if ((c.match(/"reserved_spend_micros" \+ "spent_spend_micros" \+ \$\{estimate\}\) <= "spend_limit_micros"/g) ?? []).length !== 2) {
    fail(errors, "control.reserve", "tenant and platform counters must both use the conditional remaining-budget predicate");
  }
  for (const required of ["revalidateBeforeDispatch", "loadPlatformControl", "evaluateTenantPolicy", "evaluateBudgetCounterRow", "leaseExpiresAt"]) {
    if (!c.includes(required)) {
      fail(errors, "control.revalidate", `pre-dispatch re-validation must use ${required}`);
    }
  }
  if (!/control_unreadable/.test(c)) {
    fail(errors, "control.failClosed", "an unreadable control must deny");
  }
  for (const file of ["control", "gates", "money", "maintenance"]) {
    if (/\bNumber\(|\bparseInt\(|\bparseFloat\(|\+\s*\w*[Mm]icros\w*\s*\)|\.toNumber\(/.test(src[file])) {
      fail(errors, `${file}.money`, "money must never be converted to a JavaScript number");
    }
  }
  if (/BigInt\.prototype\.toJSON\s*=|Object\.defineProperty\(\s*BigInt\.prototype/.test(governedSource)) {
    fail(errors, "money.toJSON", "a global BigInt serialisation patch is forbidden: it hides unsafe conversions");
  }

  // ---- maintenance ------------------------------------------------------------------------------------------------
  if (!/runWithAdvisoryLock/.test(src.maintenance) || !/\.unref\(\)/.test(src.maintenance)) {
    fail(errors, "maintenance", "the scheduled sweeper must hold an advisory lock and unref its timers");
  }
  if (/\$executeRaw|\$executeRawUnsafe|UPDATE |DELETE |INSERT /.test(src.maintenance)) {
    fail(errors, "maintenance.audit", "the counter audit and sweeper discovery must never write directly");
  }

  // ---- types ------------------------------------------------------------------------------------------------------
  if (!/providerCallAttempted:\s*false/.test(src.types) || !/canonicalProductMutationEnabled:\s*false/.test(src.types)) {
    fail(errors, "types", "admission results must expose the no-call and no-mutation invariants");
  }
  if (/requestedEstimatedCostMicros:\s*(number|bigint)\s*;|reservedCostMicros:\s*(number|bigint)\s*;/.test(src.types)) {
    fail(errors, "types.money", "results must carry money as decimal strings, never a number or bigint");
  }

  // ---- tenant scope -----------------------------------------------------------------------------------------------
  if (!/"AiProviderBudgetCharge"/.test(src.tenantScope)) {
    fail(errors, "tenantScope", "AiProviderBudgetCharge has a tenant_key and must be tenant scoped");
  }

  // ---- governed source: no SDK, no network, no credentials, no Product mutation -----------------------------------
  if (/from\s+["'](openai|@openai\/openai|@anthropic-ai\/sdk|@google\/generative-ai|google-genai|langchain|@langchain\/[^"']+|cohere-ai|mistralai|groq-sdk|replicate|ollama|ai)["']/.test(governedSource)) {
    fail(errors, "source.sdk", "004b-i must not import provider/model SDKs");
  }
  if (/\bfetch\s*\(|\baxios\.|\bundici\b|node:https?|\bnew\s+OpenAI\b|\bnew\s+Anthropic\b|\bGoogleGenerativeAI\b|\bXMLHttpRequest\b/.test(governedSource)) {
    fail(errors, "source.network", "004b-i must not add provider or network execution");
  }
  if (/api[_-]?key|authorization:|bearer\s/i.test(src.control + src.gates + src.maintenance + src.money)) {
    fail(errors, "source.credentials", "the control plane must not handle provider credentials");
  }
  if (/product\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(governedSource)) {
    fail(errors, "source.productMutation", "004b-i must not mutate Product records");
  }
  if (/auto-suggestions|AutoSuggestions(Module|Service)/.test(governedSource)) {
    fail(errors, "source.autoSuggestions", "004b-i must not reuse AutoSuggestions");
  }
  if (/aiSuggestion\.(create|createMany|upsert|update|updateMany)\s*\(/.test(src.control + src.maintenance + src.gates)) {
    fail(errors, "source.suggestions", "the control plane must not persist suggestions");
  }
  if (/@(Post|Patch|Put|Delete|Get)\s*\(/.test(src.control + src.maintenance)) {
    fail(errors, "source.routes", "the control plane must expose no route");
  }

  // environment reads are an explicit allow-list
  for (const file of governedFiles) {
    const text = read(file);
    const allowed = ALLOWED_ENV_READS.get(file) ?? new Set();
    for (const hit of text.match(/process\.env(?:\.[A-Za-z0-9_]+)?/g) ?? []) {
      if (!allowed.has(hit)) {
        fail(errors, "source.env", `${path.relative(REPO_ROOT, file)} reads ${hit}, which is not on the allow-list`);
      }
    }
  }
  for (const hit of extraGoverned.match(/process\.env(?:\.[A-Za-z0-9_]+)?/g) ?? []) {
    fail(errors, "source.env", `extra source reads ${hit}, which is not on the allow-list`);
  }

  // platform tables are written by operators, never by the API
  const apiSource = listSourceFiles(API_SRC).map(read).join("\n") + "\n" + src.control;
  if (/aiPlatformControl\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(apiSource)) {
    fail(errors, "platform.write", "the platform control row may be written only by operators, never by application code");
  }
  if (/aiPlatformBudgetPeriod\.(create|createMany|upsert|delete|deleteMany)\s*\(/.test(apiSource)) {
    fail(errors, "platform.write", "platform budget periods may be configured only by operators");
  }

  // no caller: nothing outside the module may reach the guarded run
  for (const file of listSourceFiles(API_SRC)) {
    const text = read(file);
    const inside = file.startsWith(INTELLIGENCE_DIR);
    if (!inside && /IntelligenceExecutionControlService|IntelligenceReservationMaintenanceService|runWithReservation/.test(text)) {
      fail(errors, "caller", `${path.relative(REPO_ROOT, file)} must not reference the provider control plane`);
    }
    if (inside && !/intelligence-execution-control\.service\.ts$|intelligence-reservation-maintenance\.service\.ts$|intelligence\.module\.ts$/.test(file) && /runWithReservation/.test(text)) {
      fail(errors, "caller", `${path.relative(REPO_ROOT, file)} must not call runWithReservation`);
    }
  }

  // ---- the real-PostgreSQL proof is wired into CI -----------------------------------------------------------------
  if (!/"test:integration:ai-provider-budget-lifecycle"/.test(src.packageJson)) {
    fail(errors, "ci", "package.json must define test:integration:ai-provider-budget-lifecycle");
  }
  if (!/npm run test:integration:ai-provider-budget-lifecycle/.test(src.ci)) {
    fail(errors, "ci", "CI must run the real-PostgreSQL budget lifecycle test");
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateProviderExecutionEligibility();
  if (!result.ok) {
    console.error("AI-PROV-004b-i provider execution control plane validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("AI-PROV-004b-i provider execution control plane validation passed: fail-closed controls only, no provider call.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateProviderExecutionEligibility,
};
