#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  // 1. ADR document exists and contains required sections
  const adrPath = path.join(REPO_ROOT, "docs/architecture/ADR-002-observability-stack.md");
  assert(fs.existsSync(adrPath), `ADR-002 not found at ${adrPath}`);
  const adrContent = fs.readFileSync(adrPath, "utf8");
  assert(adrContent.includes("Sentry"), "ADR must document Sentry as error-tracking choice");
  assert(adrContent.includes("OpenTelemetry") || adrContent.includes("OTLP"), "ADR must document OTLP/OpenTelemetry for tracing");
  assert(adrContent.includes("Prometheus"), "ADR must document Prometheus for metrics");
  assert(adrContent.includes("SENTRY_DSN"), "ADR must reference SENTRY_DSN env var");
  assert(adrContent.includes("OTEL_EXPORTER_OTLP_ENDPOINT"), "ADR must reference OTEL_EXPORTER_OTLP_ENDPOINT env var");

  // 2. ObservabilityService exists with required primitives
  const obsServicePath = path.join(REPO_ROOT, "apps/api/src/common/observability/observability.service.ts");
  assert(fs.existsSync(obsServicePath), `ObservabilityService not found at ${obsServicePath}`);
  const obsContent = fs.readFileSync(obsServicePath, "utf8");
  assert(obsContent.includes("formatPrometheus"), "ObservabilityService must expose formatPrometheus()");
  assert(obsContent.includes("increment"), "ObservabilityService must expose increment()");
  assert(obsContent.includes("observe"), "ObservabilityService must expose observe() for histograms");
  assert(obsContent.includes("pim_api_requests_total"), "ObservabilityService must track pim_api_requests_total");
  assert(obsContent.includes("pim_api_errors_total"), "ObservabilityService must track pim_api_errors_total");
  assert(obsContent.includes("pim_queue_jobs_enqueued_total"), "ObservabilityService must track queue metrics");
  assert(obsContent.includes("# TYPE"), "formatPrometheus() must emit Prometheus # TYPE lines");
  assert(obsContent.includes("# HELP"), "formatPrometheus() must emit Prometheus # HELP lines");

  // 3. ObservabilityModule is global and exported
  const obsModulePath = path.join(REPO_ROOT, "apps/api/src/common/observability/observability.module.ts");
  assert(fs.existsSync(obsModulePath), `ObservabilityModule not found at ${obsModulePath}`);
  const obsModuleContent = fs.readFileSync(obsModulePath, "utf8");
  assert(obsModuleContent.includes("@Global"), "ObservabilityModule must be @Global so any module can inject ObservabilityService");
  assert(obsModuleContent.includes("exports"), "ObservabilityModule must export ObservabilityService");

  // 4. AppModule imports ObservabilityModule
  const appModulePath = path.join(REPO_ROOT, "apps/api/src/app.module.ts");
  const appModuleContent = fs.readFileSync(appModulePath, "utf8");
  assert(appModuleContent.includes("ObservabilityModule"), "AppModule must import ObservabilityModule");

  // 5. /health/metrics endpoint exists in app.controller.ts
  const appControllerPath = path.join(REPO_ROOT, "apps/api/src/common/app.controller.ts");
  const appControllerContent = fs.readFileSync(appControllerPath, "utf8");
  assert(appControllerContent.includes("health/metrics"), "AppController must expose GET /health/metrics");
  assert(appControllerContent.includes("ObservabilityService"), "AppController must inject ObservabilityService");
  assert(appControllerContent.includes("formatPrometheus"), "AppController /health/metrics must call formatPrometheus()");
  assert(appControllerContent.includes("text/plain"), "AppController /health/metrics must set Content-Type text/plain");

  // 6. env-validation references the two new optional vars
  const envValidationPath = path.join(REPO_ROOT, "apps/api/src/common/env-validation.ts");
  const envValidationContent = fs.readFileSync(envValidationPath, "utf8");
  assert(envValidationContent.includes("SENTRY_DSN"), "env-validation must declare SENTRY_DSN");
  assert(envValidationContent.includes("OTEL_EXPORTER_OTLP_ENDPOINT"), "env-validation must declare OTEL_EXPORTER_OTLP_ENDPOINT");

  // 7. main.ts has conditional Sentry init gated on SENTRY_DSN
  const mainPath = path.join(REPO_ROOT, "apps/api/src/main.ts");
  const mainContent = fs.readFileSync(mainPath, "utf8");
  assert(mainContent.includes("SENTRY_DSN"), "main.ts must check SENTRY_DSN before loading Sentry");
  assert(mainContent.includes("@sentry/node") || mainContent.includes("sentry/node"), "main.ts must dynamically import @sentry/node");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "adr_002_exists_with_sentry_otlp_prometheus_decisions",
          "observability_service_exposes_prometheus_format",
          "observability_module_is_global_and_exported",
          "app_module_imports_observability_module",
          "health_metrics_endpoint_exists_with_correct_content_type",
          "env_validation_declares_sentry_dsn_and_otel_endpoint",
          "main_ts_conditionally_loads_sentry_on_dsn_presence",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("APM vendor decision evidence test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
