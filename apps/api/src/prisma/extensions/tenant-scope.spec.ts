import * as fs from "node:fs";
import * as path from "node:path";
import { TENANT_SCOPED_MODELS } from "./tenant-scope";

// CTO review remediation (SEC-001): the tenant-scope Prisma extension only
// protects models explicitly listed in TENANT_SCOPED_MODELS. That list is
// hand-maintained, so it has drifted from schema.prisma before (five models —
// ApiAccessKey, OutboundWebhookEndpoint, ProductPrice, OidcConfig,
// TenantAuthPolicy — had a `tenantKey` column but no automatic tenant
// isolation for months). This test is a CI guard against that class of drift:
// it fails the build the moment a new tenantKey-scoped model is added to the
// schema without also being added here.

const SCHEMA_PATH = path.join(__dirname, "../../../../../packages/db/prisma/schema.prisma");

function findTenantKeyedModels(schemaSource: string): string[] {
  const modelBlockPattern = /model\s+(\w+)\s*\{([^}]*)\}/g;
  const tenantKeyedModels: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = modelBlockPattern.exec(schemaSource)) !== null) {
    const [, modelName, body] = match;
    if (/^\s*tenantKey\s+String\b/m.test(body)) {
      tenantKeyedModels.push(modelName);
    }
  }
  return tenantKeyedModels;
}

describe("tenant-scope extension coverage", () => {
  const schemaSource = fs.readFileSync(SCHEMA_PATH, "utf8");
  const tenantKeyedModels = findTenantKeyedModels(schemaSource);

  it("parses at least one tenantKey-scoped model from schema.prisma (sanity check on the parser itself)", () => {
    expect(tenantKeyedModels.length).toBeGreaterThan(40);
  });

  it("includes every tenantKey-scoped schema.prisma model in TENANT_SCOPED_MODELS", () => {
    const missing = tenantKeyedModels.filter((model) => !TENANT_SCOPED_MODELS.has(model));
    expect(missing).toEqual([]);
  });

  it("does not list a TENANT_SCOPED_MODELS entry that no longer exists in schema.prisma with a tenantKey field", () => {
    const tenantKeyedSet = new Set(tenantKeyedModels);
    const stale = Array.from(TENANT_SCOPED_MODELS).filter((model) => !tenantKeyedSet.has(model));
    expect(stale).toEqual([]);
  });
});
