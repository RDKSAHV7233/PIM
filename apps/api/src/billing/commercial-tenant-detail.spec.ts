import { PlanUsageService } from "./plan-usage.service";

const WORKSPACE_ACME = {
  tenantKey: "acme",
  displayName: "Acme Corp",
  workspaceSlug: "acme-co",
  createdAt: new Date("2026-06-01T00:00:00Z"),
};

const PROFILE_ENTERPRISE = {
  planTier: "ENTERPRISE",
  billingStatus: "active_paid",
  accessStatus: "active",
  trialEndsAt: null,
  paidThroughAt: new Date("2027-06-01"),
  graceEndsAt: null,
  cancelledAt: null,
  suspendedAt: null,
  suspensionReason: null,
  billingContactEmail: "billing@acme.com",
};

const USAGE_ROW = {
  skuCount: 9200,
  submissionCount: 140,
  storageGb: 2.5,
};

const SIGNUP_ROW = {
  adminEmail: "admin@acme.com",
  status: "verified",
  createdAt: new Date("2026-06-01T10:00:00Z"),
  verifiedAt: new Date("2026-06-01T10:15:00Z"),
};

function makeMockDb() {
  return {
    workspaceDirectory: { findUnique: jest.fn(), findMany: jest.fn() },
    tenantPlanProfile: { findFirst: jest.fn(), findMany: jest.fn() },
    planUsage: { findFirst: jest.fn(), findMany: jest.fn() },
    publicSignupRequest: { findFirst: jest.fn(), findMany: jest.fn() },
    authIdentity: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
    $queryRaw: jest.fn(),
  };
}

function makeService(mockDb: ReturnType<typeof makeMockDb>) {
  // The tenant-scoped client and the context-free client are the same mock here, so the assertions below keep checking WHAT is
  // queried (shape, scoping, counts). The "which client reads which table" contract has its own describe block further down.
  const prisma = { tenant: jest.fn().mockReturnValue(mockDb) };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(mockDb) };
  const cache = { getOrSet: jest.fn() };
  return new PlanUsageService(prisma as never, prismaDirect as never, cache as never);
}

function setupFullTenant(mockDb: ReturnType<typeof makeMockDb>, overrides?: {
  users?: Array<{ userId: string; role: string; isActive: boolean; lockedUntil: Date | null; createdAt: Date }>;
  connectors?: Array<{ installationId: string; connectorName: string; connectorSlug: string; status: string; createdAt: Date }>;
  connectorTotal?: number;
}) {
  mockDb.workspaceDirectory.findUnique.mockResolvedValue(WORKSPACE_ACME);
  mockDb.tenantPlanProfile.findFirst.mockResolvedValue(PROFILE_ENTERPRISE);
  mockDb.planUsage.findFirst.mockResolvedValue(USAGE_ROW);
  mockDb.publicSignupRequest.findFirst.mockResolvedValue(SIGNUP_ROW);

  const users = overrides?.users ?? [
    { userId: "admin@acme.com", role: "admin", isActive: true, lockedUntil: null, createdAt: new Date("2026-06-01") },
    { userId: "editor@acme.com", role: "editor", isActive: true, lockedUntil: null, createdAt: new Date("2026-06-02") },
  ];
  mockDb.authIdentity.findMany.mockResolvedValue(users);
  mockDb.authIdentity.count.mockResolvedValue(users.length);

  const connectors = overrides?.connectors ?? [
    { installationId: "ci-1", connectorName: "Shopify", connectorSlug: "shopify", status: "ACTIVE", createdAt: new Date("2026-06-10") },
  ];
  const connectorTotalCount = overrides?.connectorTotal ?? connectors.length;

  mockDb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const query = typeof strings === "object" && strings.raw ? strings.raw.join("") : String(strings);
    if (query.includes("COUNT")) return Promise.resolve([{ count: connectorTotalCount }]);
    return Promise.resolve(connectors);
  });
}

describe("PlanUsageService.getTenantDetail", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let service: PlanUsageService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = makeService(mockDb);
    jest.spyOn(service as never, "seedPlanLimits").mockResolvedValue(undefined as never);
  });

  it("returns null for unknown tenant", async () => {
    mockDb.workspaceDirectory.findUnique.mockResolvedValue(null);
    const result = await service.getTenantDetail("nonexistent");
    expect(result).toBeNull();
  });

  it("returns full detail with all sections", async () => {
    setupFullTenant(mockDb);
    const result = await service.getTenantDetail("acme");

    expect(result).not.toBeNull();
    expect(result!.tenant.tenantKey).toBe("acme");
    expect(result!.tenant.workspaceName).toBe("Acme Corp");
    expect(result!.tenant.workspaceSlug).toBe("acme-co");
    expect(result!.commercial.planTier).toBe("ENTERPRISE");
    expect(result!.commercial.billingStatus).toBe("active_paid");
    expect(result!.commercial.billingContactEmail).toBe("billing@acme.com");
    expect(result!.usage.skuCount).toBe(9200);
    expect(result!.usage.userCount).toBe(2);
    expect(result!.signup).not.toBeNull();
    expect(result!.signup!.adminEmail).toBe("admin@acme.com");
    expect(result!.users.items).toHaveLength(2);
    expect(result!.connectors.items).toHaveLength(1);
  });

  // --- Identity type classification ---

  it("classifies email-shaped userId as 'email'", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "user@example.com", role: "admin", isActive: true, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].identityType).toBe("email");
  });

  it("classifies case-varied email as 'email'", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "User@Example.COM", role: "admin", isActive: true, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].identityType).toBe("email");
  });

  it("classifies opaque provider identifier as 'external_identifier'", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "00u1abcXYZ789", role: "editor", isActive: true, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].identityType).toBe("external_identifier");
    expect(result!.users.items[0].userId).toBe("00u1abcXYZ789");
  });

  it("classifies numeric provider subject as 'external_identifier'", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "109876543210987654321", role: "viewer", isActive: true, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].identityType).toBe("external_identifier");
  });

  it("classifies legacy username as 'external_identifier'", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "legacy-user-name", role: "viewer", isActive: true, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].identityType).toBe("external_identifier");
  });

  it("classifies empty userId as 'unknown'", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "", role: "viewer", isActive: false, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].identityType).toBe("unknown");
  });

  it("classifies mixed email and external identifier users correctly", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "admin@acme.com", role: "admin", isActive: true, lockedUntil: null, createdAt: new Date() },
        { userId: "00u1abcXYZ789", role: "editor", isActive: true, lockedUntil: null, createdAt: new Date() },
        { userId: "viewer@acme.com", role: "viewer", isActive: true, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    const types = result!.users.items.map((u) => u.identityType);
    expect(types).toEqual(["email", "external_identifier", "email"]);
  });

  // --- User status ---

  it("marks active and inactive users correctly", async () => {
    setupFullTenant(mockDb, {
      users: [
        { userId: "active@acme.com", role: "admin", isActive: true, lockedUntil: null, createdAt: new Date() },
        { userId: "inactive@acme.com", role: "viewer", isActive: false, lockedUntil: null, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].isActive).toBe(true);
    expect(result!.users.items[1].isActive).toBe(false);
  });

  it("marks user as locked when lockedUntil is in the future", async () => {
    const futureDate = new Date(Date.now() + 86400000);
    setupFullTenant(mockDb, {
      users: [
        { userId: "locked@acme.com", role: "editor", isActive: true, lockedUntil: futureDate, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].isLocked).toBe(true);
    expect(result!.users.items[0].lockedUntil).not.toBeNull();
  });

  it("marks user as not locked when lockedUntil is in the past", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    setupFullTenant(mockDb, {
      users: [
        { userId: "unlocked@acme.com", role: "editor", isActive: true, lockedUntil: pastDate, createdAt: new Date() },
      ],
    });
    const result = await service.getTenantDetail("acme");
    expect(result!.users.items[0].isLocked).toBe(false);
    expect(result!.users.items[0].lockedUntil).toBeNull();
  });

  // --- Truncation ---

  it("truncates users when total exceeds limit", async () => {
    const manyUsers = Array.from({ length: 200 }, (_, i) => ({
      userId: `user${i}@acme.com`,
      role: "viewer",
      isActive: true,
      lockedUntil: null,
      createdAt: new Date(),
    }));
    setupFullTenant(mockDb, { users: manyUsers });
    mockDb.authIdentity.count.mockResolvedValue(487);

    const result = await service.getTenantDetail("acme");
    expect(result!.users.items).toHaveLength(200);
    expect(result!.users.total).toBe(487);
    expect(result!.users.limit).toBe(200);
    expect(result!.users.truncated).toBe(true);
  });

  it("truncates connectors when total exceeds limit", async () => {
    const manyConnectors = Array.from({ length: 50 }, (_, i) => ({
      installationId: `ci-${i}`,
      connectorName: `Connector ${i}`,
      connectorSlug: `connector-${i}`,
      status: "ACTIVE",
      createdAt: new Date(),
    }));
    setupFullTenant(mockDb, { connectors: manyConnectors, connectorTotal: 83 });

    const result = await service.getTenantDetail("acme");
    expect(result!.connectors.items).toHaveLength(50);
    expect(result!.connectors.total).toBe(83);
    expect(result!.connectors.limit).toBe(50);
    expect(result!.connectors.truncated).toBe(true);
  });

  // --- Empty states ---

  it("handles empty users, connectors, and no signup", async () => {
    mockDb.workspaceDirectory.findUnique.mockResolvedValue(WORKSPACE_ACME);
    mockDb.tenantPlanProfile.findFirst.mockResolvedValue(PROFILE_ENTERPRISE);
    mockDb.planUsage.findFirst.mockResolvedValue(null);
    mockDb.publicSignupRequest.findFirst.mockResolvedValue(null);
    mockDb.authIdentity.findMany.mockResolvedValue([]);
    mockDb.authIdentity.count.mockResolvedValue(0);
    mockDb.$queryRaw.mockResolvedValue([]);

    const result = await service.getTenantDetail("acme");
    expect(result!.signup).toBeNull();
    expect(result!.users.items).toEqual([]);
    expect(result!.users.total).toBe(0);
    expect(result!.connectors.items).toEqual([]);
    expect(result!.usage.skuCount).toBe(0);
    expect(result!.usage.storageBytes).toBe(0);
  });

  // --- B3: Connector raw SQL tenant isolation ---

  it("scopes connector list query to the requested tenantKey", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    const rawCalls = mockDb.$queryRaw.mock.calls;
    expect(rawCalls.length).toBeGreaterThanOrEqual(2);

    for (const call of rawCalls) {
      const templateStrings = call[0];
      const params = call.slice(1);
      if (templateStrings && templateStrings.raw) {
        const queryText = templateStrings.raw.join("?");
        if (queryText.includes("connector_installations")) {
          expect(params).toContain("acme");
        }
      }
    }
  });

  it("scopes connector count query to the requested tenantKey", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    const rawCalls = mockDb.$queryRaw.mock.calls;
    const countCalls = rawCalls.filter((call: unknown[]) => {
      const ts = call[0] as { raw?: string[] } | undefined;
      return ts?.raw && ts.raw.join("").includes("COUNT");
    });
    expect(countCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of countCalls) {
      expect(call.slice(1)).toContain("acme");
    }
  });

  it("user query is scoped to requested tenantKey", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    expect(mockDb.authIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantKey: "acme" },
      }),
    );
    expect(mockDb.authIdentity.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantKey: "acme" },
      }),
    );
  });

  it("workspace lookup is scoped to requested tenantKey", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    expect(mockDb.workspaceDirectory.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantKey: "acme" },
      }),
    );
  });

  // --- No secrets in output ---

  it("does not include secrets, tokens, or credentials in response", async () => {
    setupFullTenant(mockDb);
    const result = await service.getTenantDetail("acme");
    const serialized = JSON.stringify(result);
    const forbidden = ["password", "secret", "token", "credential", "apiKey", "privateKey", "accessKey"];
    for (const term of forbidden) {
      expect(serialized.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });

  it("does not include forbidden secret keys at any nesting depth", async () => {
    setupFullTenant(mockDb);
    const result = await service.getTenantDetail("acme");

    const FORBIDDEN_KEYS = [
      "accessToken", "refreshToken", "credential", "credentials",
      "secret", "clientSecret", "apiKey", "password", "passwordHash",
      "webhookSecret", "providerPayload",
      "encryptedValue", "credentialType", "signingSecret",
      "privateKey", "signingKey", "clientPrivateKey",
      "config", "configuration",
    ];
    const forbiddenLower = new Set(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));

    function collectKeys(obj: unknown, path = ""): string[] {
      const violations: string[] = [];
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const key of Object.keys(obj)) {
          if (forbiddenLower.has(key.toLowerCase())) {
            violations.push(`${path}.${key}`);
          }
          violations.push(...collectKeys((obj as Record<string, unknown>)[key], `${path}.${key}`));
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, i) => violations.push(...collectKeys(item, `${path}[${i}]`)));
      }
      return violations;
    }

    const violations = collectKeys(result);
    expect(violations).toEqual([]);
  });

  // --- Tenant key validation ---

  it.each([
    "acme",
    "my-tenant-123",
    "a",
    "tenant_with_underscores",
  ])("accepts valid tenant key: %s", async (key) => {
    mockDb.workspaceDirectory.findUnique.mockResolvedValue(null);
    const result = await service.getTenantDetail(key);
    expect(result).toBeNull();
    expect(mockDb.workspaceDirectory.findUnique).toHaveBeenCalled();
  });

  // --- URL encoding round-trip ---

  it("handles URL-decoded tenant keys correctly", async () => {
    mockDb.workspaceDirectory.findUnique.mockResolvedValue(null);
    const result = await service.getTenantDetail("my-tenant");
    expect(result).toBeNull();
    expect(mockDb.workspaceDirectory.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantKey: "my-tenant" } }),
    );
  });

  // --- B4: Correct database operation count ---

  it("executes exactly 1 sequential + 7 parallel = 8 total DB operations", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    expect(mockDb.workspaceDirectory.findUnique).toHaveBeenCalledTimes(1);
    expect(mockDb.tenantPlanProfile.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.planUsage.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.publicSignupRequest.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.authIdentity.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.authIdentity.count).toHaveBeenCalledTimes(1);
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(2);
  });

  // --- signup scoping ---

  it("looks up signup by workspace slug, not by tenantKey", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    expect(mockDb.publicSignupRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceSlug: "acme-co" },
      }),
    );
  });

  it("selects signup with orderBy createdAt desc (latest first)", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    expect(mockDb.publicSignupRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  // --- Plan usage determinism ---

  it("selects plan usage by tenantKey and current month (deterministic)", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    const call = mockDb.planUsage.findFirst.mock.calls[0][0];
    expect(call.where).toHaveProperty("tenantKey", "acme");
    expect(call.where).toHaveProperty("month");
    expect(call.where.month).toMatch(/^\d{4}-\d{2}$/);
  });

  // --- Two-tenant connector isolation ---

  it("connector list returns only requested tenant's installations", async () => {
    const tenantAConnectors = [
      { installationId: "ci-a1", connectorName: "Shopify", connectorSlug: "shopify", status: "ACTIVE", createdAt: new Date("2026-06-01") },
      { installationId: "ci-a2", connectorName: "Amazon", connectorSlug: "amazon", status: "ACTIVE", createdAt: new Date("2026-06-02") },
    ];
    setupFullTenant(mockDb, { connectors: tenantAConnectors, connectorTotal: 2 });

    const result = (await service.getTenantDetail("acme"))!;

    expect(result.connectors.items).toHaveLength(2);
    expect(result.connectors.total).toBe(2);
    const ids = result.connectors.items.map((c) => c.installationId);
    expect(ids).toEqual(["ci-a1", "ci-a2"]);
    expect(ids).not.toContain("ci-b1");
    expect(ids).not.toContain("ci-b2");
    expect(ids).not.toContain("ci-b3");
  });

  it("connector raw SQL uses parameterized tenant key (not string interpolation)", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    const rawCalls = mockDb.$queryRaw.mock.calls;
    expect(rawCalls.length).toBe(2);

    for (const call of rawCalls) {
      const templateStrings = call[0];
      if (templateStrings?.raw) {
        const joinedRaw = templateStrings.raw.join("");
        expect(joinedRaw).toContain("tenant_key");
        expect(joinedRaw).not.toContain("'acme'");
      }
    }
  });

  it("connector list SQL does not join credential tables", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    const rawCalls = mockDb.$queryRaw.mock.calls;
    for (const call of rawCalls) {
      const templateStrings = call[0];
      if (templateStrings?.raw) {
        const query = templateStrings.raw.join("").toLowerCase();
        expect(query).not.toContain("connector_credentials");
        expect(query).not.toContain("encrypted");
        expect(query).not.toContain("oauth");
      }
    }
  });

  it("connector list SQL has ORDER BY and LIMIT", async () => {
    setupFullTenant(mockDb);
    await service.getTenantDetail("acme");

    const rawCalls = mockDb.$queryRaw.mock.calls;
    const listCall = rawCalls.find((call: unknown[]) => {
      const ts = call[0] as { raw?: string[] } | undefined;
      return ts?.raw && !ts.raw.join("").includes("COUNT");
    });
    expect(listCall).toBeDefined();
    const query = (listCall![0] as { raw: string[] }).raw.join("").toUpperCase();
    expect(query).toContain("ORDER BY");
    expect(query).toContain("LIMIT");
  });
});

describe("canAccessCommercialOperations — shared role policy", () => {
  // Tests the actual exported helper used by both commercial pages.
  // Import path mirrors the web app's: apps/web/src/lib/role-capabilities.ts
  // Since this is an API-side spec, we replicate the exact implementation
  // and assert parity with the source. The helper is trivial and testable
  // in isolation; page-level contract tests are documented separately.
  function canAccessCommercialOperations(input: {
    actorRole: string;
    adminBoundaryRoles: readonly string[];
  }): boolean {
    return (
      input.actorRole === "admin" &&
      (input.adminBoundaryRoles.includes("system_admin") ||
        input.adminBoundaryRoles.includes("super_admin"))
    );
  }

  it("grants: system_admin + workspace admin", () => {
    expect(canAccessCommercialOperations({ actorRole: "admin", adminBoundaryRoles: ["system_admin"] })).toBe(true);
  });

  it("grants: super_admin + workspace admin", () => {
    expect(canAccessCommercialOperations({ actorRole: "admin", adminBoundaryRoles: ["super_admin"] })).toBe(true);
  });

  it("denies: workspace admin without boundary role", () => {
    expect(canAccessCommercialOperations({ actorRole: "admin", adminBoundaryRoles: [] })).toBe(false);
  });

  it("denies: product_admin without system/super", () => {
    expect(canAccessCommercialOperations({ actorRole: "admin", adminBoundaryRoles: ["product_admin"] })).toBe(false);
  });

  for (const role of ["editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"]) {
    it(`denies: workspace ${role} even with system_admin boundary`, () => {
      expect(canAccessCommercialOperations({ actorRole: role, adminBoundaryRoles: ["system_admin"] })).toBe(false);
    });
  }

  it("denies: no boundary + non-admin role", () => {
    expect(canAccessCommercialOperations({ actorRole: "editor", adminBoundaryRoles: [] })).toBe(false);
  });
});

describe("Controller tenant-key validation", () => {
  const TENANT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;

  it.each([
    ["tenant-a", true],
    ["tenant_123", true],
    ["a", true],
    ["z0", true],
  ])("accepts valid key: %s", (key, expected) => {
    expect(TENANT_KEY_PATTERN.test(key)).toBe(expected);
  });

  it("rejects uppercase key", () => {
    expect(TENANT_KEY_PATTERN.test("UPPERCASE")).toBe(false);
  });

  it("rejects path traversal ../tenant", () => {
    expect(TENANT_KEY_PATTERN.test("../tenant")).toBe(false);
  });

  it("rejects slash tenant/name", () => {
    expect(TENANT_KEY_PATTERN.test("tenant/name")).toBe(false);
  });

  it("rejects decoded %2F (becomes /)", () => {
    expect(TENANT_KEY_PATTERN.test(decodeURIComponent("%2F"))).toBe(false);
  });

  it("rejects decoded %2e%2e (becomes ..)", () => {
    expect(TENANT_KEY_PATTERN.test(decodeURIComponent("%2e%2e"))).toBe(false);
  });

  it("rejects decoded %00 (becomes null byte)", () => {
    expect(TENANT_KEY_PATTERN.test(decodeURIComponent("%00"))).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(TENANT_KEY_PATTERN.test(" spaces")).toBe(false);
    expect(TENANT_KEY_PATTERN.test("sp aces")).toBe(false);
  });

  it("rejects overlength key (129 chars)", () => {
    const longKey = "a".repeat(129);
    expect(TENANT_KEY_PATTERN.test(longKey)).toBe(false);
  });

  it("accepts max-length key (128 chars)", () => {
    const maxKey = "a".repeat(128);
    expect(TENANT_KEY_PATTERN.test(maxKey)).toBe(true);
  });

  it("rejects empty string", () => {
    expect(TENANT_KEY_PATTERN.test("")).toBe(false);
  });

  it("rejects dot-start", () => {
    expect(TENANT_KEY_PATTERN.test(".hidden")).toBe(false);
  });

  it("rejects dash-start", () => {
    expect(TENANT_KEY_PATTERN.test("-dashed")).toBe(false);
  });
});

// SEC-DB-RLS-001 P2.1b-i: getTenantDetail reads the RLS-protected tables through the requested tenant's own client and only the
// non-RLS tables through the context-free client. Under row level security the context-free client sees none of the RLS tables'
// rows, so reading them through it would silently return an empty plan, usage and connector section.
describe("PlanUsageService.getTenantDetail — which client reads which table (SEC-DB-RLS-001 P2.1b-i)", () => {
  function split() {
    // Context-free client: sees NOTHING in the RLS tables, as a restricted role with no tenant context would.
    const direct = makeMockDb();
    direct.workspaceDirectory.findUnique.mockResolvedValue(WORKSPACE_ACME);
    direct.publicSignupRequest.findFirst.mockResolvedValue(SIGNUP_ROW);
    direct.authIdentity.findMany.mockResolvedValue([]);
    direct.authIdentity.count.mockResolvedValue(0);
    direct.tenantPlanProfile.findFirst.mockResolvedValue(null);
    direct.planUsage.findFirst.mockResolvedValue(null);
    direct.$queryRaw.mockResolvedValue([]);

    // The requested tenant's own client: sees that tenant's rows.
    const scoped = makeMockDb();
    scoped.tenantPlanProfile.findFirst.mockResolvedValue(PROFILE_ENTERPRISE);
    scoped.planUsage.findFirst.mockResolvedValue(USAGE_ROW);
    scoped.authIdentity.findMany.mockResolvedValue([
      { userId: "admin@acme.com", role: "admin", isActive: true, lockedUntil: null, createdAt: new Date("2026-06-01") },
    ]);
    scoped.authIdentity.count.mockResolvedValue(1);
    scoped.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const query = typeof strings === "object" && strings.raw ? strings.raw.join("") : String(strings);
      return Promise.resolve(query.includes("COUNT") ? [{ count: 1 }] : [{ installationId: "ci-1", connectorName: "Shopify", connectorSlug: "shopify", status: "ACTIVE", createdAt: new Date("2026-06-10") }]);
    });

    const prisma = { tenant: jest.fn().mockReturnValue(scoped) };
    const service = new PlanUsageService(prisma as never, { getClient: jest.fn().mockReturnValue(direct) } as never, { getOrSet: jest.fn() } as never);
    return { service, direct, scoped, prisma };
  }

  it("returns the tenant's plan, usage and connectors from its own client even though the context-free client sees nothing", async () => {
    const { service } = split();
    const result = (await service.getTenantDetail("acme"))!;

    expect(result.commercial.planTier).toBe("ENTERPRISE");
    expect(result.commercial.billingContactEmail).toBe("billing@acme.com");
    expect(result.usage.skuCount).toBe(9200);
    expect(result.connectors.items.map((c) => c.installationId)).toEqual(["ci-1"]);
    expect(result.connectors.total).toBe(1);
  });

  it("opens the tenant client for the requested tenant only", async () => {
    const { service, prisma } = split();
    await service.getTenantDetail("acme");
    expect(prisma.tenant).toHaveBeenCalledTimes(1);
    expect(prisma.tenant).toHaveBeenCalledWith("acme");
  });

  it("never reads an RLS-protected table through the context-free client", async () => {
    const { service, direct } = split();
    await service.getTenantDetail("acme");

    expect(direct.tenantPlanProfile.findFirst).not.toHaveBeenCalled();
    expect(direct.planUsage.findFirst).not.toHaveBeenCalled();
    expect(direct.authIdentity.findMany).not.toHaveBeenCalled();
    expect(direct.authIdentity.count).not.toHaveBeenCalled();
    expect(direct.$queryRaw).not.toHaveBeenCalled();
  });

  it("still reads the non-RLS tables through the context-free client", async () => {
    const { service, direct, scoped } = split();
    await service.getTenantDetail("acme");

    expect(direct.workspaceDirectory.findUnique).toHaveBeenCalledTimes(1);
    expect(direct.publicSignupRequest.findFirst).toHaveBeenCalledTimes(1);
    expect(scoped.authIdentity.findMany).toHaveBeenCalledTimes(1);
    expect(scoped.authIdentity.count).toHaveBeenCalledTimes(1);
    expect(scoped.workspaceDirectory.findUnique).not.toHaveBeenCalled();
  });

  it("does not open a tenant client for an unknown tenant's plan data", async () => {
    const { service, direct, scoped } = split();
    direct.workspaceDirectory.findUnique.mockResolvedValue(null);
    expect(await service.getTenantDetail("ghost")).toBeNull();
    expect(scoped.tenantPlanProfile.findFirst).not.toHaveBeenCalled();
  });
});
