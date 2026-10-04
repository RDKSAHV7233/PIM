import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IntelligenceModule } from "./intelligence.module";
import { IntelligenceService } from "./intelligence.service";

const INTELLIGENCE_DIR = __dirname;
const LEGACY_SUGGESTIONS_MODULE = ["Auto", "Suggestions", "Module"].join("");
const LEGACY_SUGGESTIONS_SERVICE = ["Auto", "Suggestions", "Service"].join("");
const PRODUCT_SERVICE_SHORTCUT = ["Catalog", "Service"].join("");
const PROVIDER_ADAPTER_NAME = ["Provider", "Adapter"].join("");
const PROVIDER_CLIENT_NAME = ["Open", "AI"].join("");

function readLocalSource(file: string): string {
  return readFileSync(join(INTELLIGENCE_DIR, file), "utf8");
}

describe("IntelligenceModule", () => {
  it("does not import existing suggestion or product mutation modules", () => {
    const imports = Reflect.getMetadata("imports", IntelligenceModule) ?? [];
    const importNames = imports.map((item: { name?: string }) => item?.name ?? String(item));

    expect(importNames).not.toContain(LEGACY_SUGGESTIONS_MODULE);
    expect(importNames).not.toContain("CatalogModule");
  });

  it("does not expose apply, provider, or canonical product mutation paths", () => {
    const serviceMethodNames = Object.getOwnPropertyNames(IntelligenceService.prototype);
    expect(serviceMethodNames).toContain("getBoundaryStatus");
    expect(serviceMethodNames.some((name) => /apply|mutate|product|provider/i.test(name))).toBe(false);

    const source = [
      readLocalSource("intelligence.controller.ts"),
      readLocalSource("intelligence.module.ts"),
      readLocalSource("intelligence.service.ts"),
    ].join("\n");

    expect(source).not.toContain(LEGACY_SUGGESTIONS_SERVICE);
    expect(source).not.toContain(PRODUCT_SERVICE_SHORTCUT);
    expect(source).not.toContain(PROVIDER_ADAPTER_NAME);
    expect(source).not.toContain(PROVIDER_CLIENT_NAME);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/product\.(update|updateMany|delete|deleteMany|upsert)\s*\(/);
    expect(source).not.toMatch(/@(Post|Patch|Put|Delete)\b/);
  });
});
