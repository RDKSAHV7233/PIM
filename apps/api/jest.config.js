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
  // Routes the connector transport seam to the (mockable) global fetch for unit specs.
  setupFiles: ["<rootDir>/../test/setup-connector-transport.ts"],
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  moduleFileExtensions: ["js", "json", "ts"],
  collectCoverageFrom: ["**/*.ts", "!**/*.module.ts", "!**/main.ts"],
};
