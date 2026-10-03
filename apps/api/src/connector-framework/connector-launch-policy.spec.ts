import type { ConnectorCap } from "./connector.interface";
import {
  resolveConnectorLaunchPolicy,
  isCustomerVisibleStage,
  isInstallableStage,
  formatLaunchStageLabel,
  resolveConnectorPipelineMetadata,
  type ConnectorLaunchStage,
} from "./connector-launch-policy";

describe("resolveConnectorLaunchPolicy", () => {
  const allCaps: ConnectorCap[] = ["VALIDATE", "PUBLISH", "STATUS_SYNC", "WEBHOOK_RECEIVE", "EXCEL_EXPORT"];

  describe("amazon-in", () => {
    it("is under_development (experimental preview, not yet production-recommended)", () => {
      const policy = resolveConnectorLaunchPolicy("amazon-in", allCaps);
      expect(policy.launchStage).toBe("under_development");
    });

    it("surfaces all capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("amazon-in", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });
  });

  describe("shopify", () => {
    it("is live", () => {
      const policy = resolveConnectorLaunchPolicy("shopify", allCaps);
      expect(policy.launchStage).toBe("live");
    });

    it("surfaces all capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("shopify", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });
  });

  describe("meesho", () => {
    it("is manual (export-only; not self-serve)", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.launchStage).toBe("manual");
    });

    it("surfaces all capabilities in manual stage", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });

    it("launchNote describes export-only model and RD-MEESHO-1 blocker", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.launchNote).toMatch(/export/i);
      expect(policy.launchNote).toMatch(/RD-MEESHO-1/);
    });

    it("is case-insensitive for slug", () => {
      const policy = resolveConnectorLaunchPolicy("MEESHO", allCaps);
      expect(policy.launchStage).toBe("manual");
    });
  });

  describe("diag-* (diagnostic connectors)", () => {
    it("resolves to internal_diagnostic", () => {
      const policy = resolveConnectorLaunchPolicy("diag-1781806774339", allCaps);
      expect(policy.launchStage).toBe("internal_diagnostic");
    });

    it("surfaces no capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("diag-1781806774339", allCaps);
      expect(policy.surfacedCapabilities).toEqual([]);
    });

    it("applies to any diag- prefix slug", () => {
      expect(resolveConnectorLaunchPolicy("diag-abc", allCaps).launchStage).toBe("internal_diagnostic");
      expect(resolveConnectorLaunchPolicy("diag-999", allCaps).launchStage).toBe("internal_diagnostic");
    });

    it("has a launchNote explaining internal-only status", () => {
      const policy = resolveConnectorLaunchPolicy("diag-test", allCaps);
      expect(policy.launchNote).toMatch(/internal/i);
      expect(policy.launchNote).toMatch(/not.*visible|not.*installable/i);
    });
  });

  describe("unknown slug", () => {
    it("defaults to live", () => {
      const policy = resolveConnectorLaunchPolicy("some-future-connector", allCaps);
      expect(policy.launchStage).toBe("live");
    });

    it("surfaces all capabilities for unknown slugs", () => {
      const policy = resolveConnectorLaunchPolicy("some-future-connector", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });

    it("has null launchNote", () => {
      const policy = resolveConnectorLaunchPolicy("some-future-connector", allCaps);
      expect(policy.launchNote).toBeNull();
    });
  });

  describe("flipkart (no explicit policy — falls through to default live)", () => {
    it("is live", () => {
      const policy = resolveConnectorLaunchPolicy("flipkart", allCaps);
      expect(policy.launchStage).toBe("live");
    });
  });

  describe("woocommerce", () => {
    it("is early_access after E2E battery sign-off (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchStage).toBe("early_access");
    });

    it("REGRESSION GUARD: woocommerce is no longer controlled_pilot — advanced to early_access (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchStage).not.toBe("controlled_pilot");
    });

    it("is installable in early_access stage — new customer installs are now open", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("launchNote states early_access copy with verified capabilities and known limitation", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchNote).toMatch(/early access/i);
      expect(policy.launchNote).toMatch(/Multi-variant publishing is not yet verified/i);
      expect(policy.launchNote).not.toMatch(/paused|p1_blocker_hold|controlled conditions/i);
    });
  });

  describe("woocommerce — P1 blockers CLOSED (2026-10-03)", () => {
    it("REGRESSION GUARD: woocommerce is no longer p1_blocker_hold — P1-1 and P1-2 closed", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchStage).not.toBe("p1_blocker_hold");
    });

    it("woocommerce resolveConnectorPipelineMetadata reflects early_access milestone", () => {
      const woo = resolveConnectorPipelineMetadata("woocommerce");
      expect(woo.milestone).toBe("early_access");
      expect(woo.blockers).not.toContain("P1-1 tenant-owned app-auth credential verification");
      expect(woo.blockers).not.toContain("P1-2 auth revocation failure policy");
      expect(woo.internalNotes).toMatch(/P1-1.*CLOSED|P1-2.*CLOSED/i);
    });
  });

  describe("myntra", () => {
    it("is under_development", () => {
      const policy = resolveConnectorLaunchPolicy("myntra", allCaps);
      expect(policy.launchStage).toBe("under_development");
    });
  });

  describe("nykaa", () => {
    it("is under_development", () => {
      const policy = resolveConnectorLaunchPolicy("nykaa", allCaps);
      expect(policy.launchStage).toBe("under_development");
    });
  });

  // PO sign-off cleared 2026-10-03 (required-team authorization, INC-89).
  describe("odoo", () => {
    it("is early_access after E2E battery sign-off (2026-10-03) and is therefore installable", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.launchStage).toBe("early_access");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: odoo is no longer po_review — advanced to early_access (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.launchStage).not.toBe("po_review");
    });

    it("surfaces all capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });

    it("launchNote states early_access copy with verified capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.launchNote).toMatch(/early access/i);
    });
  });

  // PO sign-off cleared 2026-10-03 (required-team authorization, INC-89).
  describe("prestashop", () => {
    it("is early_access after E2E battery sign-off (2026-10-03) and is therefore installable", () => {
      const policy = resolveConnectorLaunchPolicy("prestashop", allCaps);
      expect(policy.launchStage).toBe("early_access");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: prestashop is no longer po_review — advanced to early_access (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("prestashop", allCaps);
      expect(policy.launchStage).not.toBe("po_review");
    });

    it("launchNote states early_access copy with verified capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("prestashop", allCaps);
      expect(policy.launchNote).toMatch(/early access/i);
    });
  });

  // Required-team authorized advancement 2026-10-03 (INC-86 → INC-88).
  describe("shopware", () => {
    it("is early_access after E2E battery sign-off (2026-10-03) and is therefore installable", () => {
      const policy = resolveConnectorLaunchPolicy("shopware", allCaps);
      expect(policy.launchStage).toBe("early_access");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: shopware is no longer under_development", () => {
      const policy = resolveConnectorLaunchPolicy("shopware", allCaps);
      expect(policy.launchStage).not.toBe("under_development");
    });
  });

  describe("zoho-inventory", () => {
    it("is early_access after E2E battery sign-off (2026-10-03) and is therefore installable", () => {
      const policy = resolveConnectorLaunchPolicy("zoho-inventory", allCaps);
      expect(policy.launchStage).toBe("early_access");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: zoho-inventory is no longer under_development", () => {
      const policy = resolveConnectorLaunchPolicy("zoho-inventory", allCaps);
      expect(policy.launchStage).not.toBe("under_development");
    });
  });

  describe("etsy", () => {
    it("is po_review after QA fix (PR #947) and required-team authorization (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("etsy", allCaps);
      expect(policy.launchStage).toBe("po_review");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: etsy is no longer under_development", () => {
      const policy = resolveConnectorLaunchPolicy("etsy", allCaps);
      expect(policy.launchStage).not.toBe("under_development");
    });
  });

  describe("ebay", () => {
    it("is po_review after QA fix (PR #936) and required-team authorization (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("ebay", allCaps);
      expect(policy.launchStage).toBe("po_review");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: ebay is no longer under_development", () => {
      const policy = resolveConnectorLaunchPolicy("ebay", allCaps);
      expect(policy.launchStage).not.toBe("under_development");
    });
  });

  describe("bigcommerce", () => {
    it("is po_review after QA fix (PR #949) and required-team authorization (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("bigcommerce", allCaps);
      expect(policy.launchStage).toBe("po_review");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: bigcommerce is no longer under_development", () => {
      const policy = resolveConnectorLaunchPolicy("bigcommerce", allCaps);
      expect(policy.launchStage).not.toBe("under_development");
    });
  });

  describe("dynamics-365", () => {
    it("is po_review after QA tests (PR #948) and required-team authorization (2026-10-03)", () => {
      const policy = resolveConnectorLaunchPolicy("dynamics-365", allCaps);
      expect(policy.launchStage).toBe("po_review");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("REGRESSION GUARD: dynamics-365 is no longer under_development", () => {
      const policy = resolveConnectorLaunchPolicy("dynamics-365", allCaps);
      expect(policy.launchStage).not.toBe("under_development");
    });
  });
});

describe("isCustomerVisibleStage", () => {
  it("returns true for live", () => {
    expect(isCustomerVisibleStage("live")).toBe(true);
  });

  it("returns true for manual", () => {
    expect(isCustomerVisibleStage("manual")).toBe(true);
  });

  it("returns false for planned", () => {
    expect(isCustomerVisibleStage("planned")).toBe(false);
  });

  it("returns false for internal_diagnostic (diag-* connectors)", () => {
    expect(isCustomerVisibleStage("internal_diagnostic")).toBe(false);
  });

  const nonCustomerStages: ConnectorLaunchStage[] = [
    "under_development", "code_complete", "qa_validation",
    "po_review", "early_access", "controlled_pilot", "p1_blocker_hold", "deprecated", "internal_diagnostic",
  ];
  for (const stage of nonCustomerStages) {
    it(`returns false for ${stage}`, () => {
      expect(isCustomerVisibleStage(stage)).toBe(false);
    });
  }
});

describe("isInstallableStage", () => {
  it("returns true for live", () => {
    expect(isInstallableStage("live")).toBe(true);
  });

  it("returns true for manual", () => {
    expect(isInstallableStage("manual")).toBe(true);
  });

  it("returns true for early-access setup stages", () => {
    expect(isInstallableStage("code_complete")).toBe(true);
    expect(isInstallableStage("qa_validation")).toBe(true);
    expect(isInstallableStage("po_review")).toBe(true);
    expect(isInstallableStage("early_access")).toBe(true);
  });

  it("returns false for controlled_pilot and p1_blocker_hold while customer installs are process-gated", () => {
    expect(isInstallableStage("controlled_pilot")).toBe(false);
    expect(isInstallableStage("p1_blocker_hold")).toBe(false);
  });

  it("returns false for planned", () => {
    expect(isInstallableStage("planned")).toBe(false);
  });

  it("returns false for internal_diagnostic (diag-* install guard)", () => {
    expect(isInstallableStage("internal_diagnostic")).toBe(false);
  });

  const nonInstallableStages: ConnectorLaunchStage[] = [
    "under_development", "controlled_pilot", "p1_blocker_hold", "deprecated", "internal_diagnostic",
  ];
  for (const stage of nonInstallableStages) {
    it(`returns false for ${stage}`, () => {
      expect(isInstallableStage(stage)).toBe(false);
    });
  }
});

describe("formatLaunchStageLabel", () => {
  it("returns human-readable labels for all stages", () => {
    expect(formatLaunchStageLabel("live")).toBe("Live");
    expect(formatLaunchStageLabel("manual")).toBe("Manual export");
    expect(formatLaunchStageLabel("planned")).toBe("Planned");
    expect(formatLaunchStageLabel("under_development")).toBe("Under development");
    expect(formatLaunchStageLabel("code_complete")).toBe("Code complete");
    expect(formatLaunchStageLabel("qa_validation")).toBe("QA validation");
    expect(formatLaunchStageLabel("po_review")).toBe("PO review");
    expect(formatLaunchStageLabel("early_access")).toBe("Early access");
    expect(formatLaunchStageLabel("controlled_pilot")).toBe("Controlled pilot");
    expect(formatLaunchStageLabel("p1_blocker_hold")).toBe("P1 blocker-closure hold");
    expect(formatLaunchStageLabel("deprecated")).toBe("Deprecated");
    expect(formatLaunchStageLabel("internal_diagnostic")).toBe("Internal diagnostic");
  });
});

describe("resolveConnectorPipelineMetadata", () => {
  it("returns metadata for known connectors", () => {
    const shopify = resolveConnectorPipelineMetadata("shopify");
    expect(shopify.owner).toBe("Platform");
    expect(shopify.blockers).toContain("managed OAuth live verification");
    expect(shopify.blockers).toContain("webhook subscription creation");
    expect(shopify.blockers).not.toContain("#662 multi-variant metafield drift");
  });

  it("returns blockers for under-development connectors", () => {
    const amazon = resolveConnectorPipelineMetadata("amazon-in");
    expect(amazon.blockers.length).toBeGreaterThan(0);
    expect(amazon.milestone).toBe("Sprint F");
  });

  it("returns early_access metadata for Odoo after PO sign-off (2026-10-03)", () => {
    const odoo = resolveConnectorPipelineMetadata("odoo");
    expect(odoo.milestone).toBe("early_access");
    expect(odoo.blockers).not.toContain("PO review");
  });

  it("returns early_access metadata for PrestaShop after PO sign-off (2026-10-03)", () => {
    const prestashop = resolveConnectorPipelineMetadata("prestashop");
    expect(prestashop.milestone).toBe("early_access");
    expect(prestashop.blockers).not.toContain("PO review");
  });

  it("returns early_access metadata for WooCommerce after E2E battery sign-off (2026-10-03)", () => {
    const woo = resolveConnectorPipelineMetadata("woocommerce");
    expect(woo.milestone).toBe("early_access");
    expect(woo.blockers).not.toContain("P1-1 tenant-owned app-auth credential verification");
    expect(woo.blockers).not.toContain("P1-2 auth revocation failure policy");
    expect(woo.owner).toBe("Platform");
  });

  it("returns unknown owner for unregistered slugs", () => {
    const unknown = resolveConnectorPipelineMetadata("some-new-connector");
    expect(unknown.owner).toBe("Unknown");
  });
});

describe("diag-* end-to-end policy checks", () => {
  const allCaps: ConnectorCap[] = ["VALIDATE", "PUBLISH", "STATUS_SYNC", "WEBHOOK_RECEIVE", "EXCEL_EXPORT"];

  it("diag-* resolves to internal_diagnostic and is not customer-visible or installable", () => {
    const policy = resolveConnectorLaunchPolicy("diag-1781806774339", allCaps);
    expect(policy.launchStage).toBe("internal_diagnostic");
    expect(isCustomerVisibleStage(policy.launchStage)).toBe(false);
    expect(isInstallableStage(policy.launchStage)).toBe(false);
  });

  it("pipeline page isCustomerVisible returns false for internal_diagnostic", () => {
    expect(isCustomerVisibleStage("internal_diagnostic")).toBe(false);
  });
});
