import type { ConnectorCap } from "./connector.interface";
import {
  resolveConnectorLaunchPolicy,
  isCustomerVisibleStage,
  isInstallableStage,
  formatLaunchStageLabel,
  resolveConnectorPipelineMetadata,
  type ConnectorLaunchStage,
} from "./connector-launch-policy";
import { runWithTenantContext } from "../common/tenant/tenant-context";

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
    it("is p1_blocker_hold while P1 closure is open", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchStage).toBe("p1_blocker_hold");
    });

    it("launchNote blocks onboarding and install until required signoff", () => {
      const policy = resolveConnectorLaunchPolicy("woocommerce", allCaps);
      expect(policy.launchNote).toMatch(/onboarding and install are paused/i);
      expect(policy.launchNote).toMatch(/P1-1/);
      expect(policy.launchNote).toMatch(/P1-2/);
      expect(policy.launchNote).toMatch(/fresh CTO\/PO\/Security\/QA\/SRE signoff/i);
      expect(policy.launchNote).not.toMatch(/approved.*controlled pilot/i);
      expect(policy.launchNote).not.toMatch(/available to install/i);
    });
  });

  // PIM#817: explicitly-opted-in override so the missing real WooCommerce
  // onboarding + tenant-owned credential-write proof can actually be
  // produced, WITHOUT reopening WooCommerce for any real customer tenant.
  //
  // CORRECTED 2026-09-17: originally gated on APP_ENV=staging alone. A
  // same-day docs audit (PIM#867) confirmed this deployment has only ONE
  // Railway environment — internally named "Staging" in APP_ENV terms — and
  // it serves real customer traffic, including a paying ENTERPRISE pilot
  // tenant. APP_ENV=staging is therefore true on the live system at all
  // times; it can never be used to distinguish "safe to test" from "real
  // customers are on this." Fixed by additionally requiring the CURRENT
  // REQUEST'S TENANT (via tenant context, the same mechanism every other
  // tenant-scoped service in this codebase uses) to exactly match one
  // explicitly-designated proof tenant. The tests below prove the fix: the
  // override must stay OFF for a different tenant sharing the same
  // environment and flag, and must FAIL CLOSED (not fail open) when no
  // proof tenant is configured at all.
  describe("woocommerce — PIM#817 staging proof override", () => {
    const ORIGINAL_ENV = { ...process.env };
    const PROOF_TENANT = "woo-p1-proof-tenant";
    const REAL_CUSTOMER_TENANT = "acme-enterprise-pilot";

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    function resolveAsTenant(tenantKey: string, slug: string) {
      return runWithTenantContext(tenantKey, () => resolveConnectorLaunchPolicy(slug, allCaps));
    }

    it("stays p1_blocker_hold when no env var is set", () => {
      delete process.env.APP_ENV;
      delete process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED;
      delete process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY;
      expect(resolveAsTenant(PROOF_TENANT, "woocommerce").launchStage).toBe("p1_blocker_hold");
    });

    it("stays p1_blocker_hold when APP_ENV=staging but the flag is not set", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      delete process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED;
      expect(resolveAsTenant(PROOF_TENANT, "woocommerce").launchStage).toBe("p1_blocker_hold");
    });

    it("stays p1_blocker_hold when the flag is set but APP_ENV is production", () => {
      process.env.APP_ENV = "production";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      expect(resolveAsTenant(PROOF_TENANT, "woocommerce").launchStage).toBe("p1_blocker_hold");
    });

    it("stays p1_blocker_hold when the flag is set but APP_ENV is development", () => {
      process.env.APP_ENV = "development";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      expect(resolveAsTenant(PROOF_TENANT, "woocommerce").launchStage).toBe("p1_blocker_hold");
    });

    it("REGRESSION GUARD: stays p1_blocker_hold when APP_ENV=staging and the flag is true but no proof tenant is configured — must fail closed, not unlock every tenant in the environment", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      delete process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY;
      expect(resolveAsTenant(REAL_CUSTOMER_TENANT, "woocommerce").launchStage).toBe("p1_blocker_hold");
      expect(resolveAsTenant(PROOF_TENANT, "woocommerce").launchStage).toBe("p1_blocker_hold");
    });

    it("REGRESSION GUARD: a real customer tenant stays p1_blocker_hold even with both env vars set, because it is not the designated proof tenant", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      const policy = resolveAsTenant(REAL_CUSTOMER_TENANT, "woocommerce");
      expect(policy.launchStage).toBe("p1_blocker_hold");
      expect(isInstallableStage(policy.launchStage)).toBe(false);
    });

    it("resolves to early_access (installable) only for the designated proof tenant, with both env vars set", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      const policy = resolveAsTenant(PROOF_TENANT, "woocommerce");
      expect(policy.launchStage).toBe("early_access");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("trims surrounding whitespace from the configured proof tenant key, same normalizeTenantKey() every other tenant-scoped lookup in this codebase uses", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = `  ${PROOF_TENANT}  `;
      const policy = resolveAsTenant(PROOF_TENANT, "woocommerce");
      expect(policy.launchStage).toBe("early_access");
    });

    it("is exact-match, not case-folded — tenant keys are case-sensitive elsewhere in this codebase, so a differently-cased tenant key must not match", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT.toUpperCase();
      const policy = resolveAsTenant(PROOF_TENANT, "woocommerce");
      expect(policy.launchStage).toBe("p1_blocker_hold");
    });

    it("override launchNote states the tenant-scoped mechanism, not a blanket production-safety claim", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      const policy = resolveAsTenant(PROOF_TENANT, "woocommerce");
      expect(policy.launchNote).toMatch(/TEMPORARY/);
      expect(policy.launchNote).toMatch(/ONLY for the one tenant/i);
      expect(policy.launchNote).toMatch(/PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY/);
      expect(policy.launchNote).toMatch(/NOT the full named CTO\/PO\/Security\/QA\/SRE signoff/i);
    });

    it("other connectors are never affected by the override, even for the proof tenant", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      expect(resolveAsTenant(PROOF_TENANT, "shopify").launchStage).toBe("live");
      expect(resolveAsTenant(PROOF_TENANT, "meesho").launchStage).toBe("manual");
    });

    it("resolveConnectorPipelineMetadata reflects the override, scoped to the proof tenant, when queried from that tenant's context", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      const woo = runWithTenantContext(PROOF_TENANT, () => resolveConnectorPipelineMetadata("woocommerce"));
      expect(woo.internalNotes).toMatch(/Vishal \(CTO\)/);
      expect(woo.internalNotes).toMatch(/designated proof tenant/i);
      expect(woo.internalNotes).toMatch(/Revert by unsetting both env vars/i);
      expect(woo.blockers.join(" ")).toMatch(/PO\/Security\/QA\/SRE still outstanding/i);
    });

    it("resolveConnectorPipelineMetadata stays on the original hold metadata for a real customer tenant even while the override is active for the proof tenant", () => {
      process.env.APP_ENV = "staging";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED = "true";
      process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY = PROOF_TENANT;
      const woo = runWithTenantContext(REAL_CUSTOMER_TENANT, () => resolveConnectorPipelineMetadata("woocommerce"));
      expect(woo.milestone).toBe("P1 blocker-closure hold");
    });

    it("resolveConnectorPipelineMetadata stays on the original hold metadata when the override is off entirely", () => {
      delete process.env.APP_ENV;
      delete process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED;
      delete process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY;
      const woo = resolveConnectorPipelineMetadata("woocommerce");
      expect(woo.milestone).toBe("P1 blocker-closure hold");
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

  // QA validation passed (2026-09-22, PR #935 merged): duplicate-reference
  // risk found and fixed in validateProduct(). Stage advanced from
  // "under_development" to "po_review" — QA cleared; PO sign-off and a
  // customer pilot remain before go-live. "po_review" IS in
  // isInstallableStage(), making the connector installable for PO evaluation.
  describe("odoo", () => {
    it("is po_review after QA validation (PR #935) and is therefore installable", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.launchStage).toBe("po_review");
      expect(isInstallableStage(policy.launchStage)).toBe(true);
    });

    it("surfaces all capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });

    it("launchNote references QA validation passing and remaining PO/pilot gates", () => {
      const policy = resolveConnectorLaunchPolicy("odoo", allCaps);
      expect(policy.launchNote).toMatch(/QA validation passed/i);
      expect(policy.launchNote).toMatch(/customer pilot/i);
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

  it("returns PO/pilot blockers for Odoo (QA cleared), matching its po_review launch stage", () => {
    const odoo = resolveConnectorPipelineMetadata("odoo");
    expect(odoo.blockers).not.toContain("QA validation");
    expect(odoo.blockers).toContain("PO review");
    expect(odoo.blockers).toContain("customer pilot");
  });

  it("returns P1 blockers for held WooCommerce connectors", () => {
    const woo = resolveConnectorPipelineMetadata("woocommerce");
    expect(woo.milestone).toBe("P1 blocker-closure hold");
    expect(woo.blockers).toContain("P1-1 tenant-owned app-auth credential verification");
    expect(woo.blockers).toContain("P1-2 auth revocation failure policy");
    expect(woo.blockers).not.toContain("QA validation");
    expect(woo.blockers).not.toContain("PO review");
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
