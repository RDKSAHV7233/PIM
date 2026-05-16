/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testMatch: [
    "**/connector-framework/connector-launch-policy.spec.ts",
    "**/bulk-import/bulk-import.service.spec.ts",
    "**/marketplace/marketplace.service.spec.ts",
    "**/connectors/amazon/amazon-validation.spec.ts",
    "**/connectors/flipkart/flipkart-category-rules.spec.ts",
  ],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  moduleFileExtensions: ["js", "json", "ts"],
  collectCoverageFrom: ["**/*.ts", "!**/*.module.ts", "!**/main.ts"],
};
