import * as fs from "node:fs";
import * as path from "node:path";
import { resolveConnectorLaunchPolicy } from "../connector-framework/connector-launch-policy";
import { evaluatePublicationTarget } from "./publication-target.evaluator";
import {
  CONNECTOR_EVIDENCE_MANIFEST,
  EVIDENCE_REVERIFY_DEFAULT_DAYS,
  PUBLISH_CONNECTOR_CAPABILITIES,
  buildEvidenceManifest,
  defaultReverifyBy,
  evidenceForConnector,
  validateEvidenceManifest,
} from "./publication-target.evidence-manifest";
import type { CapabilityEvidence } from "./publication-target.types";
import { CONTEXT, NOW, condition, readyInput } from "./publication-target.test-fixtures";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DAY = 86_400_000;

function inventory(): Array<{ slug: string; capabilities: string[] }> {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs", "connectors", "CONNECTOR_INVENTORY.json"), "utf8")) as {
    inventory: Array<{ slug: string; capabilities: string[] }>;
  };
  return raw.inventory;
}

const level = (connector: string, capability: string, p: string) =>
  CONNECTOR_EVIDENCE_MANIFEST.find((entry) => entry.connector === connector && entry.capability === capability && entry.path === p)?.level;

describe("evidence manifest", () => {
  it("is valid under the ADR-0015 manifest rules", () => {
    expect(validateEvidenceManifest(CONNECTOR_EVIDENCE_MANIFEST)).toEqual([]);
  });

  it("has an entry for every declared capability on both paths, even when untested", () => {
    const expected = Object.values(PUBLISH_CONNECTOR_CAPABILITIES).reduce((total, capabilities) => total + capabilities.length * 2, 0);
    expect(CONNECTOR_EVIDENCE_MANIFEST).toHaveLength(expected);
    for (const [connector, capabilities] of Object.entries(PUBLISH_CONNECTOR_CAPABILITIES)) {
      for (const capability of capabilities) {
        expect(level(connector, capability, "direct_adapter")).toBeDefined();
        expect(level(connector, capability, "product_pipeline")).toBeDefined();
      }
    }
  });

  describe("declared capabilities match the generated connector inventory (no silent drift)", () => {
    it("every connector that declares PUBLISH is covered, with the same capabilities, and no other connector has entries", () => {
      const publishing = inventory().filter((entry) => entry.capabilities.includes("PUBLISH"));
      expect(publishing.map((entry) => entry.slug).sort()).toEqual(Object.keys(PUBLISH_CONNECTOR_CAPABILITIES).sort());
      for (const entry of publishing) {
        expect([...(PUBLISH_CONNECTOR_CAPABILITIES[entry.slug] ?? [])].sort()).toEqual([...entry.capabilities].sort());
      }
      const manifestConnectors = new Set(CONNECTOR_EVIDENCE_MANIFEST.map((entry) => entry.connector));
      for (const exportOnly of inventory().filter((entry) => !entry.capabilities.includes("PUBLISH"))) {
        expect(manifestConnectors.has(exportOnly.slug)).toBe(false);
      }
    });
  });

  describe("what is recorded above untested (pinned: any change must be deliberate)", () => {
    const recorded = CONNECTOR_EVIDENCE_MANIFEST.filter((entry) => entry.level !== "untested").map(
      (entry) => `${entry.connector}|${entry.capability}|${entry.path}=${entry.level}`,
    );

    it("is exactly this set", () => {
      expect(recorded.sort()).toEqual(
        [
          "bigcommerce|PUBLISH|direct_adapter=unit_tested",
          "bigcommerce|STATUS_SYNC|direct_adapter=unit_tested",
          "bigcommerce|VALIDATE|direct_adapter=unit_tested",
          "dynamics-365|PUBLISH|direct_adapter=integration_tested",
          "dynamics-365|STATUS_SYNC|direct_adapter=integration_tested",
          "dynamics-365|VALIDATE|direct_adapter=sandbox_verified",
          "ebay|PUBLISH|direct_adapter=integration_tested",
          "ebay|STATUS_SYNC|direct_adapter=sandbox_verified",
          "ebay|VALIDATE|direct_adapter=sandbox_verified",
          "etsy|PUBLISH|direct_adapter=sandbox_verified",
          "etsy|STATUS_SYNC|direct_adapter=sandbox_verified",
          "etsy|VALIDATE|direct_adapter=sandbox_verified",
          "odoo|PUBLISH|direct_adapter=sandbox_verified",
          "odoo|STATUS_SYNC|direct_adapter=sandbox_verified",
          "odoo|VALIDATE|direct_adapter=sandbox_verified",
          "prestashop|PUBLISH|direct_adapter=sandbox_verified",
          "prestashop|STATUS_SYNC|direct_adapter=sandbox_verified",
          "prestashop|VALIDATE|direct_adapter=sandbox_verified",
          "shopify|PUBLISH|product_pipeline=production_verified",
          "shopware|PUBLISH|direct_adapter=sandbox_verified",
          "shopware|STATUS_SYNC|direct_adapter=sandbox_verified",
          "shopware|VALIDATE|direct_adapter=sandbox_verified",
          "woocommerce|PUBLISH|product_pipeline=production_verified",
          "zoho-inventory|PUBLISH|direct_adapter=sandbox_verified",
          "zoho-inventory|STATUS_SYNC|direct_adapter=sandbox_verified",
          "zoho-inventory|VALIDATE|direct_adapter=sandbox_verified",
        ].sort(),
      );
    });

    it("ADR-0007's Gate 0 baseline levels are not carried over without an event behind them", () => {
      // The baseline lists these as verified; no dated, referenced event was found, so they are untested here.
      for (const [connector, capability] of [
        ["flipkart", "PUBLISH"],
        ["flipkart", "VALIDATE"],
        ["flipkart", "STATUS_SYNC"],
        ["flipkart", "EXCEL_EXPORT"],
        ["shopify", "VALIDATE"],
        ["shopify", "STATUS_SYNC"],
        ["shopify", "WEBHOOK_RECEIVE"],
        ["woocommerce", "VALIDATE"],
        ["woocommerce", "STATUS_SYNC"],
        ["woocommerce", "WEBHOOK_RECEIVE"],
        ["myntra", "VALIDATE"],
      ] as const) {
        expect(level(connector, capability, "direct_adapter")).toBe("untested");
        expect(level(connector, capability, "product_pipeline")).toBe("untested");
      }
    });

    it("only Shopify and WooCommerce PUBLISH have any product_pipeline evidence; every Tier-2 connector has none", () => {
      const pipeline = CONNECTOR_EVIDENCE_MANIFEST.filter((entry) => entry.path === "product_pipeline" && entry.level !== "untested");
      expect(pipeline.map((entry) => `${entry.connector}|${entry.capability}`).sort()).toEqual(["shopify|PUBLISH", "woocommerce|PUBLISH"]);
    });

    it("nothing is certified", () => {
      expect(CONNECTOR_EVIDENCE_MANIFEST.some((entry) => entry.level === "certified")).toBe(false);
    });

    it("every recorded entry names a reference, a role and a date, and expires at the policy default", () => {
      for (const entry of CONNECTOR_EVIDENCE_MANIFEST.filter((e) => e.level !== "untested")) {
        expect(entry.evidenceRef).toBeTruthy();
        expect(entry.verifiedBy).toBe("QA");
        expect(Date.parse(entry.verifiedAt!)).toBeGreaterThan(0);
        if (entry.level === "sandbox_verified" || entry.level === "production_verified") {
          expect(Date.parse(entry.reverifyBy!) - Date.parse(entry.verifiedAt!)).toBe(30 * DAY);
        } else {
          expect(entry.reverifyBy).toBeNull();
        }
      }
    });
  });

  describe("defaultReverifyBy", () => {
    it("applies the policy default by level", () => {
      expect(EVIDENCE_REVERIFY_DEFAULT_DAYS).toEqual({ sandbox_verified: 30, production_verified: 30, certified: 90 });
      expect(defaultReverifyBy("sandbox_verified", "2026-10-01")).toBe("2026-10-31T00:00:00.000Z");
      expect(defaultReverifyBy("production_verified", "2026-10-01")).toBe("2026-10-31T00:00:00.000Z");
      expect(defaultReverifyBy("certified", "2026-10-01")).toBe("2026-12-30T00:00:00.000Z");
    });

    it("levels below sandbox_verified, and undated or unparseable evidence, get no date", () => {
      for (const lowered of ["untested", "unit_tested", "integration_tested"] as const) expect(defaultReverifyBy(lowered, "2026-10-01")).toBeNull();
      expect(defaultReverifyBy("certified", null)).toBeNull();
      expect(defaultReverifyBy("certified", "yesterday")).toBeNull();
    });

    it("an explicit shorter date wins; an explicit longer date does not", () => {
      expect(defaultReverifyBy("certified", "2026-10-01", "2026-11-01")).toBe("2026-11-01T00:00:00.000Z");
      expect(defaultReverifyBy("sandbox_verified", "2026-10-01", "2027-01-01")).toBe("2026-10-31T00:00:00.000Z");
      expect(defaultReverifyBy("sandbox_verified", "2026-10-01", "garbage")).toBe("2026-10-31T00:00:00.000Z");
    });
  });

  describe("validateEvidenceManifest catches each fault", () => {
    const good = (): CapabilityEvidence[] => [...CONNECTOR_EVIDENCE_MANIFEST];
    const withEntry = (overrides: Partial<CapabilityEvidence>, base = "odoo|PUBLISH|direct_adapter") =>
      good().map((entry) => (`${entry.connector}|${entry.capability}|${entry.path}` === base ? { ...entry, ...overrides } : entry));

    it.each([
      ["a duplicate entry", () => [...good(), good()[0]!], /duplicate entry/],
      ["a missing entry", () => good().slice(1), /missing entry/],
      ["an unregistered connector", () => [...good(), { ...good()[0]!, connector: "ghost" }], /not a registered PUBLISH connector/],
      ["an undeclared capability", () => [...good(), { ...good()[0]!, capability: "BULK_PUBLISH" }], /not declared by the connector/],
      ["a verified level without a reference", () => withEntry({ evidenceRef: null }), /without an evidenceRef/],
      ["a verified level without verifiedBy", () => withEntry({ verifiedBy: null }), /without verifiedBy/],
      ["a verified level without a date", () => withEntry({ verifiedAt: null }), /parseable verifiedAt/],
      ["sandbox evidence without reverifyBy", () => withEntry({ reverifyBy: null }), /without a parseable reverifyBy/],
      ["a reverifyBy beyond the policy default", () => withEntry({ reverifyBy: "2027-12-31T00:00:00.000Z" }), /exceeds the 30-day policy default/],
      ["a reverifyBy before verifiedAt", () => withEntry({ reverifyBy: "2026-01-01T00:00:00.000Z" }), /not after verifiedAt/],
      ["an untested entry carrying evidence", () => withEntry({ level: "untested" }, "amazon-in|PUBLISH|direct_adapter").map((e) => (e.connector === "amazon-in" && e.capability === "PUBLISH" && e.path === "direct_adapter" ? { ...e, evidenceRef: "x" } : e)), /untested entry carries evidence fields/],
      ["an unknown level", () => withEntry({ level: "excellent" as never }), /unknown level/],
      ["integration evidence with a reverifyBy", () => withEntry({ level: "integration_tested", reverifyBy: "2026-11-01T00:00:00.000Z" }), /should carry no reverifyBy/],
    ])("%s", (_label, build, expected) => {
      const problems = validateEvidenceManifest(build() as CapabilityEvidence[]);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join("\n")).toMatch(expected as RegExp);
    });
  });

  it("buildEvidenceManifest never adds an untested row over a recorded one", () => {
    const manifest = buildEvidenceManifest();
    const keys = manifest.map((entry) => `${entry.connector}|${entry.capability}|${entry.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe("what the evaluator makes of the manifest today (capability_verified, real launch policy, 2026-10-06)", () => {
    const outcome = (slug: string) => {
      const policy = resolveConnectorLaunchPolicy(slug, ["PUBLISH", "VALIDATE", "STATUS_SYNC"]);
      const definition = { slug, displayName: slug, isActive: true, capabilities: [...(PUBLISH_CONNECTOR_CAPABILITIES[slug] ?? [])] };
      const result = evaluatePublicationTarget(
        readyInput({ slug, definition, launchPolicy: { launchStage: policy.launchStage, reason: policy.reason }, evidence: evidenceForConnector(slug) }),
        CONTEXT,
      );
      const entry = condition(result, "capability_verified");
      return `${policy.launchStage}: ${entry.status}${entry.code ? ` ${entry.code}` : ""}`;
    };

    it.each([
      ["amazon-in", "under_development: not_applicable"],
      ["myntra", "under_development: not_applicable"],
      ["woocommerce", "p1_blocker_hold: not_applicable"],
      ["bigcommerce", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["dynamics-365", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["ebay", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["etsy", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["odoo", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["prestashop", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["shopware", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["zoho-inventory", "early_access: fail CAPABILITY_NOT_VERIFIED"],
      ["flipkart", "live: fail CAPABILITY_NOT_VERIFIED"],
      ["shopify", "live: fail CAPABILITY_NOT_VERIFIED"],
    ])("%s -> %s", (slug, expected) => {
      expect(outcome(slug)).toBe(expected);
    });

    it("no registered PUBLISH connector has evidence that would make it available", () => {
      for (const slug of Object.keys(PUBLISH_CONNECTOR_CAPABILITIES)) {
        const policy = resolveConnectorLaunchPolicy(slug, ["PUBLISH"]);
        const result = evaluatePublicationTarget(
          readyInput({
            slug,
            definition: { slug, displayName: slug, isActive: true, capabilities: [...PUBLISH_CONNECTOR_CAPABILITIES[slug]!] },
            launchPolicy: { launchStage: policy.launchStage, reason: policy.reason },
            evidence: evidenceForConnector(slug),
          }),
          CONTEXT,
        );
        expect(condition(result, "capability_verified").status).not.toBe("pass");
      }
    });

    it("Shopify's August pipeline evidence would pass at early_access while it was current, and has expired since", () => {
      const evidence = evidenceForConnector("shopify");
      const early = (now: Date) =>
        condition(
          evaluatePublicationTarget(readyInput({ slug: "shopify", launchPolicy: { launchStage: "early_access" }, evidence }), { ...CONTEXT, now }),
          "capability_verified",
        );
      expect(early(new Date("2026-09-01T00:00:00Z")).status).toBe("pass");
      expect(early(NOW).code).toBe("RECERTIFICATION_REQUIRED");
    });
  });
});
