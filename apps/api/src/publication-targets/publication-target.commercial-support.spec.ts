import * as fs from "node:fs";
import * as path from "node:path";
import { PUBLISH_CONNECTOR_CAPABILITIES } from "./publication-target.evidence-manifest";
import {
  COMMERCIAL_SUPPORT_RECORDS,
  resolveCommercialSupportFact,
  validateCommercialSupportRecords,
  type CommercialSupportRecord,
} from "./publication-target.commercial-support";
import { NOW } from "./publication-target.test-fixtures";

const CONNECTORS = Object.keys(PUBLISH_CONNECTOR_CAPABILITIES);

const record = (overrides: Partial<CommercialSupportRecord> = {}): CommercialSupportRecord => ({
  connector: "odoo",
  commerciallySupported: true,
  approvedBy: "PO",
  approvalRef: "PO-2026-10-06-ODOO",
  approvedAt: "2026-10-01T00:00:00.000Z",
  validUntil: null,
  revokedAt: null,
  reason: "Supported for the early-access cohort",
  ...overrides,
});

describe("commercial-support records", () => {
  it("the committed set is empty: no Product Owner commercial-support approval exists for any connector", () => {
    expect(COMMERCIAL_SUPPORT_RECORDS).toEqual([]);
    expect(validateCommercialSupportRecords(COMMERCIAL_SUPPORT_RECORDS, CONNECTORS)).toEqual([]);
  });

  it("every connector resolves to no fact (not supported) today, whatever its launch stage", () => {
    for (const connector of CONNECTORS) expect(resolveCommercialSupportFact(connector, NOW)).toBeNull();
  });

  it("is never derived from a launch stage or an adapter: the module has no reference to either", () => {
    const source = fs.readFileSync(path.join(__dirname, "publication-target.commercial-support.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/launchStage|launch-policy|resolveConnectorLaunchPolicy|connector-framework/);
  });

  describe("resolveCommercialSupportFact", () => {
    it("a valid Product Owner record yields a supportive fact with its approval reference", () => {
      expect(resolveCommercialSupportFact("odoo", NOW, [record()])).toEqual({ commerciallySupported: true, approvedBy: "PO", approvalRef: "PO-2026-10-06-ODOO" });
    });

    it("normalizes the slug", () => {
      expect(resolveCommercialSupportFact("  ODOO ", NOW, [record()])).not.toBeNull();
    });

    it.each([
      ["another connector", record({ connector: "etsy" })],
      ["a record that does not support", record({ commerciallySupported: false })],
      ["an approver other than the Product Owner", record({ approvedBy: "Engineering" as never })],
      ["no approval reference", record({ approvalRef: "" })],
      ["a blank approval reference", record({ approvalRef: "   " })],
      ["an unparseable approvedAt", record({ approvedAt: "soon" })],
      ["an approval dated in the future", record({ approvedAt: new Date(NOW.getTime() + 1).toISOString() })],
      ["an expired record", record({ validUntil: new Date(NOW.getTime() - 1).toISOString() })],
      ["a record expiring exactly now", record({ validUntil: NOW.toISOString() })],
      ["a revoked record", record({ revokedAt: new Date(NOW.getTime() - 1).toISOString() })],
      ["a record revoked exactly now", record({ revokedAt: NOW.toISOString() })],
      ["an unparseable expiry", record({ validUntil: "never" })],
    ])("does not count %s", (_label, candidate) => {
      expect(resolveCommercialSupportFact("odoo", NOW, [candidate])).toBeNull();
    });

    it("a record revoked in the future still counts until then", () => {
      expect(resolveCommercialSupportFact("odoo", NOW, [record({ revokedAt: new Date(NOW.getTime() + DAY).toISOString() })])).not.toBeNull();
    });

    it("when a newer record replaces a revoked one, the current one is used", () => {
      const fact = resolveCommercialSupportFact("odoo", NOW, [
        record({ approvalRef: "OLD", approvedAt: "2026-09-01T00:00:00.000Z", revokedAt: "2026-09-30T00:00:00.000Z" }),
        record({ approvalRef: "NEW", approvedAt: "2026-10-02T00:00:00.000Z" }),
      ]);
      expect(fact?.approvalRef).toBe("NEW");
    });
  });

  describe("validateCommercialSupportRecords", () => {
    it("accepts a well-formed record", () => {
      expect(validateCommercialSupportRecords([record()], CONNECTORS)).toEqual([]);
    });

    it.each([
      ["an unknown connector", record({ connector: "ghost" }), /unknown connector/],
      ["a non-PO approver", record({ approvedBy: "CTO" as never }), /approvedBy must be PO/],
      ["a missing approval reference", record({ approvalRef: " " }), /missing approvalRef/],
      ["a missing reason", record({ reason: "" }), /missing reason/],
      ["an unparseable approvedAt", record({ approvedAt: "x" }), /unparseable approvedAt/],
      ["validUntil not after approvedAt", record({ validUntil: "2026-09-01T00:00:00.000Z" }), /validUntil is not after approvedAt/],
      ["revokedAt before approvedAt", record({ revokedAt: "2026-09-01T00:00:00.000Z" }), /revokedAt precedes approvedAt/],
    ])("rejects %s", (_label, candidate, expected) => {
      expect(validateCommercialSupportRecords([candidate], CONNECTORS).join("\n")).toMatch(expected);
    });

    it("rejects two unrevoked supporting records for one connector", () => {
      expect(validateCommercialSupportRecords([record(), record({ approvalRef: "OTHER" })], CONNECTORS).join("\n")).toMatch(/unrevoked supporting records/);
    });
  });
});

const DAY = 86_400_000;
