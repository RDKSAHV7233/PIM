/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Pre-existing: one Jest worker occasionally fails to exit cleanly when the
  // full suite runs in parallel.  The warning is non-fatal (all tests pass) and
  // is caused by a race in Jest's inter-worker IPC under high parallelism.
  // maxWorkers limits concurrent workers to avoid the race; openHandlesTimeout
  // gives any lingering I/O references additional drain time; forceExit ensures
  // CI runners do not block waiting for a stuck worker.
  maxWorkers: 2,
  openHandlesTimeout: 10000,
  forceExit: true,
  rootDir: "src",
  testMatch: [
    "**/audit/audit.service.spec.ts",
    "**/connector-framework/connector-launch-policy.spec.ts",
    "**/connector-framework/connector-framework.service.spec.ts",
    "**/connector-framework/connector-http-client.spec.ts",
    "**/bulk-import/bulk-import.service.spec.ts",
    "**/marketplace/marketplace.service.spec.ts",
    "**/connectors/amazon/amazon-validation.spec.ts",
    "**/connectors/amazon/amazon.connector.spec.ts",
    "**/connectors/flipkart/flipkart-category-rules.spec.ts",
    "**/connectors/flipkart/flipkart.connector.spec.ts",
    "**/connectors/meesho/meesho-category-templates.spec.ts",
    "**/billing/commercial-reminders.service.spec.ts",
    "**/connector-installer/connector-installer.service.spec.ts",
    "**/bulk-import/bulk-import-run.service.spec.ts",
    "**/connector-installer/credential-encryption.util.spec.ts",
    "**/compliance/compliance.service.spec.ts",
  ],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  moduleFileExtensions: ["js", "json", "ts"],
  collectCoverageFrom: ["**/*.ts", "!**/*.module.ts", "!**/main.ts"],
};
