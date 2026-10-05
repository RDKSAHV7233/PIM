import {
  CHARGE_ORDER,
  DEPLOY_FLAG_ENV,
  DISPATCH_LEASE_MS,
  PROVIDER_TIMEOUT_MS,
  dayPeriodKey,
  evaluateBudgetCounterRow,
  evaluatePlatformControl,
  evaluateTenantPolicy,
  isLiveCapability,
  monthPeriodKey,
  parseDeployFlag,
  readDeployFlag,
  type BudgetCounterRow,
  type PlatformControlRow,
  type TenantPolicyRow,
} from "./intelligence-execution-gates";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const control = (overrides: Partial<PlatformControlRow> = {}): PlatformControlRow => ({
  id: "global",
  enabled: true,
  killSwitch: false,
  allowedProvider: "anthropic",
  allowedModel: "model-x",
  allowedTenantKeys: ["tenant-a"],
  maxRequestCostMicros: 250_000n,
  ...overrides,
});

const gateInput = { tenantKey: "tenant-a", providerKey: "anthropic", modelKey: "model-x", estimatedCostMicros: 1_000n };

const policy = (overrides: Partial<TenantPolicyRow> = {}): TenantPolicyRow => ({
  intelligenceEnabled: true,
  providerExecutionEnabled: true,
  killSwitchEnabled: false,
  tenantOptOut: false,
  approvedBy: "owner",
  approvedAt: new Date("2026-10-01T00:00:00.000Z"),
  maxPayloadBytes: 4096,
  allowedCapabilities: ["product_attribute_extraction"],
  allowedProviderKeys: ["anthropic"],
  ...overrides,
});

const counter = (overrides: Partial<BudgetCounterRow> = {}): BudgetCounterRow => ({
  id: "c1",
  enabled: true,
  currency: "USD",
  spendLimitMicros: 5_000_000n,
  reservedSpendMicros: 0n,
  spentSpendMicros: 0n,
  requestLimit: 10,
  requestCount: 0,
  periodStartedAt: new Date("2026-10-01T00:00:00.000Z"),
  periodEndsAt: new Date("2026-11-01T00:00:00.000Z"),
  ...overrides,
});

describe("G0 deploy flag", () => {
  it("is ON only for the exact word true, case-insensitive and trimmed", () => {
    for (const on of ["true", "TRUE", " True ", "tRuE\n"]) {
      expect(parseDeployFlag(on)).toBe(true);
    }
  });

  it("is OFF for unset, empty, garbage and every near-miss", () => {
    for (const off of [undefined, null, "", " ", "1", "yes", "on", "enabled", "truee", "true;", "true false", "false", "0", "t"]) {
      expect(parseDeployFlag(off as string | undefined)).toBe(false);
    }
  });

  it("reads the environment on each call and never caches", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(readDeployFlag(env)).toBe(false);
    env[DEPLOY_FLAG_ENV] = "true";
    expect(readDeployFlag(env)).toBe(true);
    env[DEPLOY_FLAG_ENV] = "banana";
    expect(readDeployFlag(env)).toBe(false);
  });
});

describe("G1 platform control", () => {
  it("allows only when readable, enabled, not killed, tenant allow-listed, pinned and within the request cap", () => {
    expect(evaluatePlatformControl(control(), gateInput)).toBeNull();
  });

  it("denies a missing row and a malformed row", () => {
    expect(evaluatePlatformControl(null, gateInput)).toBe("platform_control_missing");
    expect(evaluatePlatformControl(undefined, gateInput)).toBe("platform_control_missing");
    expect(evaluatePlatformControl(control({ id: "other" }), gateInput)).toBe("platform_control_invalid");
    expect(evaluatePlatformControl(control({ maxRequestCostMicros: -1n }), gateInput)).toBe("platform_control_invalid");
    expect(evaluatePlatformControl({ ...control(), enabled: "yes" as unknown as boolean }, gateInput)).toBe("platform_control_invalid");
    expect(evaluatePlatformControl({ ...control(), allowedTenantKeys: null as unknown as string[] }, gateInput)).toBe("platform_control_invalid");
  });

  it("denies when killed, even if everything else is enabled, and kill wins over disabled", () => {
    expect(evaluatePlatformControl(control({ killSwitch: true }), gateInput)).toBe("platform_kill_switch");
    expect(evaluatePlatformControl(control({ killSwitch: true, enabled: false }), gateInput)).toBe("platform_kill_switch");
  });

  it("denies when disabled, tenant not allow-listed, or the provider or model pin differs or is unset", () => {
    expect(evaluatePlatformControl(control({ enabled: false }), gateInput)).toBe("platform_feature_disabled");
    expect(evaluatePlatformControl(control({ allowedTenantKeys: [] }), gateInput)).toBe("tenant_not_allowlisted");
    expect(evaluatePlatformControl(control({ allowedTenantKeys: ["tenant-b"] }), gateInput)).toBe("tenant_not_allowlisted");
    expect(evaluatePlatformControl(control({ allowedProvider: "other" }), gateInput)).toBe("provider_pin_mismatch");
    expect(evaluatePlatformControl(control({ allowedModel: "model-y" }), gateInput)).toBe("provider_pin_mismatch");
    expect(evaluatePlatformControl(control({ allowedProvider: null }), gateInput)).toBe("provider_pin_mismatch");
    expect(evaluatePlatformControl(control({ allowedModel: null }), gateInput)).toBe("provider_pin_mismatch");
  });

  it("denies a zero request cap and an estimate above the cap, and allows exactly the cap", () => {
    expect(evaluatePlatformControl(control({ maxRequestCostMicros: 0n }), gateInput)).toBe("request_cost_exceeded");
    expect(evaluatePlatformControl(control(), { ...gateInput, estimatedCostMicros: 250_001n })).toBe("request_cost_exceeded");
    expect(evaluatePlatformControl(control(), { ...gateInput, estimatedCostMicros: 250_000n })).toBeNull();
  });

  it("the seeded default row denies everything", () => {
    const seeded = control({ enabled: false, killSwitch: true, allowedProvider: null, allowedModel: null, allowedTenantKeys: [], maxRequestCostMicros: 0n });
    expect(evaluatePlatformControl(seeded, gateInput)).toBe("platform_kill_switch");
  });
});

describe("G2 tenant policy and the provider half of G3", () => {
  it("allows a fully enabled, approved policy", () => {
    expect(evaluateTenantPolicy(policy(), "product_attribute_extraction", "anthropic")).toBeNull();
  });

  it("denies the default policy shape (kill switch on, opted out)", () => {
    expect(evaluateTenantPolicy(policy({ killSwitchEnabled: true }), "product_attribute_extraction", "anthropic")).toBe("tenant_provider_disabled");
    expect(evaluateTenantPolicy(policy({ tenantOptOut: true }), "product_attribute_extraction", "anthropic")).toBe("tenant_provider_disabled");
    expect(evaluateTenantPolicy(policy({ providerExecutionEnabled: false }), "product_attribute_extraction", "anthropic")).toBe("tenant_provider_disabled");
    expect(evaluateTenantPolicy(policy({ intelligenceEnabled: false }), "product_attribute_extraction", "anthropic")).toBe("tenant_provider_disabled");
  });

  it("denies an unapproved, zero-payload or malformed policy and disallowed capability or provider", () => {
    expect(evaluateTenantPolicy(policy({ approvedBy: null }), "product_attribute_extraction", "anthropic")).toBe("invalid_tenant_policy");
    expect(evaluateTenantPolicy(policy({ approvedAt: null }), "product_attribute_extraction", "anthropic")).toBe("invalid_tenant_policy");
    expect(evaluateTenantPolicy(policy({ maxPayloadBytes: 0 }), "product_attribute_extraction", "anthropic")).toBe("invalid_tenant_policy");
    expect(evaluateTenantPolicy(policy({ allowedCapabilities: "product_attribute_extraction" }), "product_attribute_extraction", "anthropic")).toBe("capability_disallowed");
    expect(evaluateTenantPolicy(policy({ allowedCapabilities: [] }), "product_attribute_extraction", "anthropic")).toBe("capability_disallowed");
    expect(evaluateTenantPolicy(policy({ allowedProviderKeys: null }), "product_attribute_extraction", "anthropic")).toBe("tenant_provider_disabled");
    expect(evaluateTenantPolicy(policy({ allowedProviderKeys: ["other"] }), "product_attribute_extraction", "anthropic")).toBe("tenant_provider_disabled");
  });

  it("the code-level live allow-list names exactly one capability", () => {
    expect(isLiveCapability("product_attribute_extraction")).toBe(true);
    expect(isLiveCapability("product_specification_extraction")).toBe(false);
    expect(isLiveCapability("")).toBe(false);
  });
});

describe("G4 budget counter row validity", () => {
  it("allows a valid row and denies a missing one", () => {
    expect(evaluateBudgetCounterRow(counter(), NOW)).toBeNull();
    expect(evaluateBudgetCounterRow(null, NOW)).toBe("missing_budget_policy");
  });

  it("denies disabled, wrong currency, zero limits, negative counters and out-of-window rows", () => {
    const denied = [
      counter({ enabled: false }),
      counter({ currency: "EUR" }),
      counter({ spendLimitMicros: 0n }),
      counter({ requestLimit: 0 }),
      counter({ reservedSpendMicros: -1n }),
      counter({ spentSpendMicros: -1n }),
      counter({ requestCount: -1 }),
      counter({ periodStartedAt: new Date("2026-10-16T00:00:00.000Z") }),
      counter({ periodEndsAt: NOW }),
      counter({ periodEndsAt: new Date("2026-10-01T00:00:00.000Z") }),
      counter({ effectiveFrom: new Date("2026-10-20T00:00:00.000Z") }),
      counter({ effectiveUntil: NOW }),
    ];
    for (const row of denied) {
      expect(evaluateBudgetCounterRow(row, NOW)).toBe("invalid_budget_policy");
    }
  });
});

describe("period keys, lock order and lease arithmetic", () => {
  it("derives UTC day and month keys on the server", () => {
    expect(dayPeriodKey(new Date("2026-10-05T23:59:59.999Z"))).toBe("D:2026-10-05");
    expect(monthPeriodKey(new Date("2026-10-05T23:59:59.999Z"))).toBe("M:2026-10");
    expect(dayPeriodKey(new Date("2026-12-31T23:59:59.999Z"))).toBe("D:2026-12-31");
    expect(monthPeriodKey(new Date("2027-01-01T00:00:00.000Z"))).toBe("M:2027-01");
  });

  it("charges counters in one fixed order, platform before tenant, month before day", () => {
    expect(CHARGE_ORDER).toEqual(["platform_month", "platform_day", "tenant_month", "tenant_day"]);
  });

  it("the dispatch lease always outlasts the provider timeout", () => {
    expect(DISPATCH_LEASE_MS).toBeGreaterThan(PROVIDER_TIMEOUT_MS);
  });
});
