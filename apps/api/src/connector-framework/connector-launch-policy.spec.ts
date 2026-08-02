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
    it("is code_complete", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchStage).toBe("code_complete");
    });
  });

  describe("myntra", () => {
    it("is live", () => {
      const policy = resolveConnectorLaunchPolicy("myntra", allCaps);
      expect(policy.launchStage).toBe("live");
    });
  });

  describe("nykaa", () => {
    it("is manual", () => {
      const policy = resolveConnectorLaunchPolicy("nykaa", allCaps);
      expect(policy.launchStage).toBe("manual");
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
    "po_review", "early_access", "deprecated", "internal_diagnostic",
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

  it("returns false for planned", () => {
    expect(isInstallableStage("planned")).toBe(false);
  });

  it("returns false for internal_diagnostic (diag-* install guard)", () => {
    expect(isInstallableStage("internal_diagnostic")).toBe(false);
  });

  const nonInstallableStages: ConnectorLaunchStage[] = [
    "under_development", "deprecated", "internal_diagnostic",
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
    expect(formatLaunchStageLabel("deprecated")).toBe("Deprecated");
    expect(formatLaunchStageLabel("internal_diagnostic")).toBe("Internal diagnostic");
  });
});

describe("resolveConnectorPipelineMetadata", () => {
  it("returns metadata for known connectors", () => {
    const shopify = resolveConnectorPipelineMetadata("shopify");
    expect(shopify.owner).toBe("Platform");
    expect(shopify.blockers).toEqual([]);
  });

  it("returns blockers for under-development connectors", () => {
    const amazon = resolveConnectorPipelineMetadata("amazon-in");
    expect(amazon.blockers.length).toBeGreaterThan(0);
    expect(amazon.milestone).toBe("Sprint F");
  });

  it("returns blockers for code-complete connectors", () => {
    const woo = resolveConnectorPipelineMetadata("woocommerce");
    expect(woo.blockers).toContain("QA validation");
    expect(woo.blockers).toContain("PO review");
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
