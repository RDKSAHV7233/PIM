#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SERVICE_ENTRY = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "dist",
  "connector-framework",
  "connector-framework.service.js",
);
const ERROR_ENTRY = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "dist",
  "connector-framework",
  "connector.errors.js",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildInstallation(overrides = {}) {
  return {
    id: "inst_1",
    tenantKey: "tenant_1",
    connectorId: "connector_1",
    slug: "meesho",
    displayName: "Meesho",
    accountAlias: "primary",
    externalAccountRef: null,
    status: "ACTIVE",
    capabilities: ["VALIDATE", "EXCEL_EXPORT"],
    metadata: {},
    installedAt: new Date().toISOString(),
    installedBy: "user_1",
    lastSyncAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildPayload() {
  return {
    sku: "SKU-1",
    title: "Sample Product",
    description: "Sample Description",
    brand: "TEJ PIM",
    hsnCode: "62046200",
    gstRate: 18,
    mrp: 1999,
    sellingPrice: 1499,
    mainImageUrl: "https://cdn.example.com/p1.jpg",
    attributes: { color: "black" },
    productType: "apparel",
  };
}

async function expectCapabilityError(fn, capability) {
  try {
    await fn();
    throw new Error("Expected CapabilityNotSupportedError but call succeeded.");
  } catch (error) {
    assert(
      error && error.name === "CapabilityNotSupportedError",
      `Expected CapabilityNotSupportedError, got ${error?.name ?? "unknown"}`,
    );
    assert(
      String(error.message).includes(`'${capability}'`),
      `Expected error message to mention capability '${capability}', got: ${String(error.message)}`,
    );
  }
}

async function run() {
  const { ConnectorFrameworkService } = require(SERVICE_ENTRY);
  const { CapabilityNotSupportedError } = require(ERROR_ENTRY);

  const noPublishConnector = {
    slug: "meesho",
    displayName: "Meesho",
    capabilities: ["VALIDATE", "EXCEL_EXPORT"],
    validateCredentials: async () => true,
    validateProduct: async () => ({ isValid: true, errors: [], warnings: [], source: "LOCAL_RULES" }),
    normaliseError: () => ({
      code: "ERR",
      fieldPath: "",
      sellerMessage: "error",
      severity: "error",
    }),
  };

  const publishConnector = {
    ...noPublishConnector,
    slug: "flipkart",
    displayName: "Flipkart",
    capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
    publishProduct: async () => ({
      externalRef: "ext_1",
      status: "PENDING",
      isAsync: true,
    }),
  };

  const noSubmissionConnector = {
    ...noPublishConnector,
    slug: "legacy",
    capabilities: ["VALIDATE"],
  };

  const prismaStub = { tenant: () => ({}) };

  const publishGuardService = new ConnectorFrameworkService(prismaStub, {
    getConnector: () => noPublishConnector,
  });
  await expectCapabilityError(
    () => publishGuardService.publish(buildInstallation(), buildPayload()),
    "PUBLISH",
  );

  const exportOnlyService = new ConnectorFrameworkService(prismaStub, {
    getConnector: () => noPublishConnector,
  });
  const exportOnlyResult = await exportOnlyService.submitOrExport(buildInstallation(), buildPayload());
  assert(exportOnlyResult.mode === "export_only", "Expected export-only completion mode for Meesho.");
  assert(
    exportOnlyResult.completion === "connector_export_only",
    "Expected explicit export-only completion marker.",
  );

  const publishService = new ConnectorFrameworkService(prismaStub, {
    getConnector: () => publishConnector,
  });
  const publishResult = await publishService.submitOrExport(
    buildInstallation({
      slug: "flipkart",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
    }),
    buildPayload(),
  );
  assert(publishResult.mode === "publish", "Expected publish mode for publish-capable connector.");
  assert(
    publishResult.submission.externalRef === "ext_1",
    "Expected publish mode to return submission reference.",
  );

  const unsupportedService = new ConnectorFrameworkService(prismaStub, {
    getConnector: () => noSubmissionConnector,
  });
  await expectCapabilityError(
    () =>
      unsupportedService.submitOrExport(
        buildInstallation({
          slug: "legacy",
          capabilities: ["VALIDATE"],
        }),
        buildPayload(),
      ),
    "PUBLISH",
  );

  const sampleError = new CapabilityNotSupportedError("meesho", "PUBLISH");
  assert(
    sampleError.name === "CapabilityNotSupportedError",
    "Capability error type name should remain deterministic.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "publish_flow_capability_guard",
          "explicit_export_only_completion_path",
          "deterministic_unsupported_capability_error",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Connector capability orchestration integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
