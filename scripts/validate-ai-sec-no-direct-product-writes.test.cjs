#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateNoDirectAiProductWrites } = require("./validate-ai-sec-no-direct-product-writes.cjs");

function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sec-guard-"));
  try {
    return callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

function writeFile(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function validate(repoRoot) {
  return validateNoDirectAiProductWrites({ repoRoot });
}

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.service.ts"),
    "export class IntelligenceService { getBoundary() { return { canonicalProductMutationEnabled: false }; } }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, true, result.governed.findings.map((finding) => finding.message).join("\n"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.service.ts"),
    "export class IntelligenceService { apply(prisma) { return prisma.tenant().product.update({ where: {}, data: {} }); } }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "direct_product_mutation"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.service.ts"),
    "export class IntelligenceService { apply(tx) { return tx.product.update({ where: {}, data: {} }); } }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "transaction_product_mutation"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.service.ts"),
    "import { CatalogService } from '../catalog/catalog.service';\nexport class IntelligenceService {}\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "catalog_service_import"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.module.ts"),
    "import { AutoSuggestionsModule } from '../auto-suggestions/auto-suggestions.module';\nexport class IntelligenceModule {}\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "auto_suggestions_reuse"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.service.ts"),
    "export class IntelligenceService { apply(catalogService) { return catalogService.updateProduct('p1', {}); } }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "catalog_mutation_method_reuse"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "intelligence.controller.ts"),
    "import { Patch } from '@nestjs/common';\nexport class IntelligenceController { @Patch(':id') apply() {} }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "write_route_decorator"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "provider.ts"),
    "export async function run() { return fetch('https://example.invalid'); }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "provider_execution_call"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "intelligence", "provider.ts"),
    "import OpenAI from 'openai';\nexport const client = new OpenAI();\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, false);
  assert(result.governed.findings.some((finding) => finding.ruleId === "provider_sdk_import"));
  assert(result.governed.findings.some((finding) => finding.ruleId === "provider_client_instantiation"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "rejection-intelligence", "rejection-intelligence.service.ts"),
    "export class RejectionIntelligenceService { summarize() { return { readOnly: true }; } }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, true, result.governed.findings.map((finding) => finding.message).join("\n"));
});

withTempRepo((repoRoot) => {
  writeFile(
    repoRoot,
    path.join("apps", "api", "src", "auto-suggestions", "auto-suggestions.service.ts"),
    "export class AutoSuggestionsService { apply(prisma) { return prisma.tenant().product.update({ where: {}, data: {} }); } }\n",
  );
  const result = validate(repoRoot);
  assert.equal(result.ok, true, "legacy excluded path should be informational, not failing");
  assert(result.legacy.findings.some((finding) => finding.ruleId === "legacy_product_mutation"));
});

console.log("AI-SEC-001 direct AI Product write guard tests passed.");
