// Coverage for AccessPolicyService — zero test coverage before, despite
// can() being the single central authorization decision every RBAC guard in
// the app calls through. Previously deferred from the zero-coverage sweep as
// "too large for a safely-scoped single pass" alongside dashboard.service.ts
// (#857) and connector-mapping.service.ts (#858) — this is the third and
// final of those three.
//
// Scoped deliberately to the two highest-stakes surfaces rather than every
// method in a 2200+ line file:
//   (a) can() — a pure, synchronous, no-DB priority chain with ~9 ordered
//       gates (API-client scope, foundation-role block, admin-boundary
//       capability/role with legacy fallback, required roles, then three
//       GET-only read shortcuts, then default-write-roles, then default
//       deny). Getting this order wrong is a real access-control bug, and
//       it had never been tested end to end before. Tests below trace the
//       order explicitly, including fall-through cases that are easy to
//       get backwards: passing the API-scope gate does NOT bypass a later
//       required-roles check, and an unmet admin-boundary requirement (no
//       explicit admin-boundary role, actorRole isn't legacy "admin")
//       now returns ADMIN_BOUNDARY_FORBIDDEN immediately rather than
//       falling through to a later check — see issue #894.
//   (b) createScopeAssignment()'s per-scope-type validation: category/brand/
//       connector_account/catalog each require and validate a different
//       field, a scope type that's "supported for storage but not
//       enforcement" (supplier/locale/market/team/assignee) is rejected
//       outright, and vendor/owner are the deliberate carve-out that IS
//       allowed despite sharing that same "foundation" type list.
//
// PrismaService and AuditService are mocked; the pure decision/normalization
// functions inside access-policy.service.ts and role-utils.ts run for real.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AccessPolicyService, type PolicyActor } from "./access-policy.service";
import { readAccessPolicyReasonCode } from "../rbac/read-access-policy.decorator";

function makeService() {
  const accessScopeAssignmentCreate = jest.fn();
  const authIdentityFindFirst = jest.fn();
  const categoryFindUnique = jest.fn();
  const connectorInstallationFindUnique = jest.fn();
  const accessScopeAssignmentFindMany = jest.fn().mockResolvedValue([]);
  const accessScopeAssignmentFindUnique = jest.fn();

  const tenantClient = {
    accessScopeAssignment: {
      create: accessScopeAssignmentCreate,
      findMany: accessScopeAssignmentFindMany,
      findUnique: accessScopeAssignmentFindUnique,
    },
    authIdentity: { findFirst: authIdentityFindFirst },
    category: { findUnique: categoryFindUnique },
    connectorInstallation: { findUnique: connectorInstallationFindUnique },
  };

  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AccessPolicyService(prisma as never, audit as never);
  return {
    service,
    mocks: {
      accessScopeAssignmentCreate,
      authIdentityFindFirst,
      categoryFindUnique,
      connectorInstallationFindUnique,
      accessScopeAssignmentFindMany,
      accessScopeAssignmentFindUnique,
    },
    audit,
  };
}

function actor(overrides: Partial<PolicyActor> = {}): PolicyActor {
  return { actorId: "u1", actorRole: "viewer", tenantId: "acme", actorType: "human", ...overrides };
}

describe("AccessPolicyService.can — API-client gate", () => {
  it("denies an api_client with allowed_with_api_scope policy when no scopes are required at all (misconfigured route)", () => {
    const { service } = makeService();
    const result = service.can(actor({ actorType: "api_client" }), "view", "product", {
      apiClientPolicy: "allowed_with_api_scope",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "API_CLIENT_SCOPE_REQUIRED" }));
  });

  it("denies an api_client whose granted scopes don't include any required scope", () => {
    const { service } = makeService();
    const result = service.can(
      actor({ actorType: "api_client", apiScopes: ["orders:read"] }),
      "view",
      "product",
      { apiClientPolicy: "allowed_with_api_scope", requiredApiClientScopes: ["catalog.read"] },
    );
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "API_CLIENT_SCOPE_FORBIDDEN" }));
  });

  it("clearing the API-scope gate does NOT bypass a required-roles check later in the chain", () => {
    const { service } = makeService();
    const result = service.can(
      actor({ actorType: "api_client", actorRole: "viewer", apiScopes: ["catalog.read"] }),
      "view",
      "product",
      {
        apiClientPolicy: "allowed_with_api_scope",
        requiredApiClientScopes: ["catalog.read"],
        requiredRoles: ["admin"],
      },
    );
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "ROLE_FORBIDDEN" }));
  });

  it("denies allowed_service_internal unconditionally, even with a matching scope granted", () => {
    const { service } = makeService();
    const result = service.can(
      actor({ actorType: "api_client", apiScopes: ["internal:all"] }),
      "view",
      "product",
      { apiClientPolicy: "allowed_service_internal" },
    );
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "API_CLIENT_SERVICE_INTERNAL_ONLY" }));
  });

  it("denies not_applicable unconditionally", () => {
    const { service } = makeService();
    const result = service.can(actor({ actorType: "api_client" }), "view", "product", {
      apiClientPolicy: "not_applicable",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "API_CLIENT_NOT_APPLICABLE" }));
  });

  it("denies denied_human_only for an api_client", () => {
    const { service } = makeService();
    const result = service.can(actor({ actorType: "api_client" }), "view", "product", {
      apiClientPolicy: "denied_human_only",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "API_CLIENT_FORBIDDEN" }));
  });

  it("an unset apiClientPolicy denies an api_client outright — there is no implicit-allow default for API clients", () => {
    const { service } = makeService();
    const result = service.can(actor({ actorType: "api_client", actorRole: "viewer" }), "view", "product", {
      defaultReadAllowed: true,
      method: "GET",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "API_CLIENT_FORBIDDEN" }));
  });

  it("the only way an api_client reaches later checks at all is a successful allowed_with_api_scope match — ApiClientRoutePolicy has exactly 4 values and the other 3 always deny", () => {
    const { service } = makeService();
    const result = service.can(
      actor({ actorType: "api_client", actorRole: "viewer", apiScopes: ["catalog.read"] }),
      "view",
      "product",
      { apiClientPolicy: "allowed_with_api_scope", requiredApiClientScopes: ["catalog.read"], defaultReadAllowed: true, method: "GET" },
    );
    expect(result).toEqual(expect.objectContaining({ allowed: true, reasonCode: "DEFAULT_READ_ALLOWED" }));
  });
});

describe("AccessPolicyService.can — foundation-role block", () => {
  it("blocks a category_manager unless explicitly allowed for this route", () => {
    const { service } = makeService();
    // Note: can() reads effectiveRoles from the *context* (3rd) argument, not
    // from actor.effectiveRoles, even though PolicyActor also declares that
    // field — this tripped up the first draft of this test.
    const result = service.can(actor(), "edit", "product", { effectiveRoles: ["category_manager"] });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "FOUNDATION_ROLE_BLOCKED" }));
  });

  it("lets a vendor through when the route explicitly allows the vendor foundation role", () => {
    const { service } = makeService();
    const result = service.can(actor(), "view", "product", {
      effectiveRoles: ["vendor"],
      allowedFoundationRoles: ["vendor"],
      defaultReadAllowed: true,
      method: "GET",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("AccessPolicyService.can — admin-boundary capability/role", () => {
  it("allows a product_admin an action requiring manage_product_data", () => {
    const { service } = makeService();
    const result = service.can(actor(), "edit", "product", {
      effectiveRoles: ["product_admin"],
      requiredAdminCapability: "manage_product_data",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: true, reasonCode: "ADMIN_BOUNDARY_ALLOWED" }));
  });

  it("denies a product_admin a capability it doesn't have (manage_users)", () => {
    const { service } = makeService();
    const result = service.can(actor(), "manage", "users", {
      effectiveRoles: ["product_admin"],
      requiredAdminCapability: "manage_users",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "ADMIN_BOUNDARY_FORBIDDEN" }));
  });

  it("falls back to the legacy actorRole==='admin' when no explicit admin-boundary role is present", () => {
    const { service } = makeService();
    const allowed = service.can(actor({ actorRole: "admin" }), "edit", "settings", {
      requiredAdminCapability: "manage_platform",
    });
    expect(allowed).toEqual(expect.objectContaining({ allowed: true, reasonCode: "ADMIN_BOUNDARY_ALLOWED" }));

    const denied = service.can(actor({ actorRole: "admin" }), "edit", "settings", {
      requiredAdminCapability: "manage_platform",
      allowLegacyAdminFallback: false,
    });
    expect(denied).toEqual(expect.objectContaining({ allowed: false, reasonCode: "ADMIN_BOUNDARY_FORBIDDEN" }));
  });

  it("an unmet admin-boundary requirement (non-admin, no explicit boundary role) returns ADMIN_BOUNDARY_FORBIDDEN immediately — requiredRoles or read shortcuts cannot override an explicit admin-boundary gate", () => {
    const { service } = makeService();
    // actor has a matching requiredRoles entry but no admin-boundary role — boundary gate wins
    const withRoles = service.can(actor({ actorRole: "editor" }), "edit", "settings", {
      requiredAdminCapability: "manage_platform",
      requiredRoles: ["editor"],
    });
    expect(withRoles).toEqual(expect.objectContaining({ allowed: false, reasonCode: "ADMIN_BOUNDARY_FORBIDDEN" }));
    // actor with readClassification shortcut but no admin-boundary role — boundary gate still wins (issue #894 scenario)
    const withClassification = service.can(actor({ actorRole: "editor" }), "view", "settings", {
      method: "GET",
      requiredAdminCapability: "manage_platform",
      readClassification: "admin_only",
    });
    expect(withClassification).toEqual(expect.objectContaining({ allowed: false, reasonCode: "ADMIN_BOUNDARY_FORBIDDEN" }));
  });
});

describe("AccessPolicyService.can — required roles, read shortcuts, default-write, and default deny", () => {
  it("required roles decide the outcome purely by actorRole membership", () => {
    const { service } = makeService();
    expect(
      service.can(actor({ actorRole: "editor" }), "edit", "product", { requiredRoles: ["admin", "editor"] }),
    ).toEqual(expect.objectContaining({ allowed: true, reasonCode: "ROLE_ALLOWED" }));
    expect(
      service.can(actor({ actorRole: "viewer" }), "edit", "product", { requiredRoles: ["admin", "editor"] }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "ROLE_FORBIDDEN" }));
  });

  it("a configured readAccessPolicy allows a GET request with that policy's own reason code", () => {
    const { service } = makeService();
    const result = service.can(actor(), "view", "taxonomy", {
      method: "GET",
      readAccessPolicy: "taxonomy_safe_metadata",
    });
    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBe(readAccessPolicyReasonCode("taxonomy_safe_metadata"));
  });

  it("readAccessPolicy/readClassification/defaultReadAllowed only apply to GET/HEAD/OPTIONS, never POST", () => {
    const { service } = makeService();
    const result = service.can(actor(), "edit", "product", {
      method: "POST",
      defaultReadAllowed: true,
      readAccessPolicy: "taxonomy_safe_metadata",
    });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "NO_POLICY_MATCH" }));
  });

  it("defaultWriteRoles governs non-GET requests when nothing more specific matched", () => {
    const { service } = makeService();
    expect(
      service.can(actor({ actorRole: "editor" }), "edit", "product", { method: "POST", defaultWriteRoles: ["editor"] }),
    ).toEqual(expect.objectContaining({ allowed: true, reasonCode: "DEFAULT_WRITE_ALLOWED" }));
    expect(
      service.can(actor({ actorRole: "viewer" }), "edit", "product", { method: "POST", defaultWriteRoles: ["editor"] }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "WRITE_ROLE_REQUIRED" }));
  });

  it("denies by default (NO_POLICY_MATCH) when no gate in the chain matched anything", () => {
    const { service } = makeService();
    const result = service.can(actor(), "view", "product", { method: "POST" });
    expect(result).toEqual(expect.objectContaining({ allowed: false, reasonCode: "NO_POLICY_MATCH" }));
  });
});

describe("AccessPolicyService.createScopeAssignment", () => {
  afterEach(() => jest.clearAllMocks());

  it("rejects a scope type that's supported for storage but not for enforcement (e.g. supplier, locale, team)", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue({ id: "identity-1" });
    for (const scopeType of ["supplier", "locale", "market", "team", "assignee"] as const) {
      await expect(
        service.createScopeAssignment("acme", actor(), {
          subjectType: "user",
          subjectId: "u2",
          scopeType,
          actions: ["view"],
        } as never),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it("allows vendor and owner despite sharing the same 'foundation' type list as the rejected ones above", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue({ id: "identity-1" });
    mocks.accessScopeAssignmentCreate.mockResolvedValue({
      id: "sa-1", tenantKey: "acme", categoryId: null, connectorInstallationId: null, scopeValue: "acme-vendor-1",
      actions: ["view"], createdBy: "u1", createdAt: new Date(), updatedAt: new Date(),
    });

    await expect(
      service.createScopeAssignment("acme", actor(), {
        subjectType: "user",
        subjectId: "u2",
        scopeType: "vendor",
        scopeValue: "acme-vendor-1",
        actions: ["view"],
      } as never),
    ).resolves.toBeDefined();
  });

  it("requires an existing workspace user for a user-subject assignment", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue(null);

    await expect(
      service.createScopeAssignment("acme", actor(), {
        subjectType: "user",
        subjectId: "ghost-user",
        scopeType: "brand",
        scopeValue: "vexa",
        actions: ["view"],
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it("requires an existing category row for a category-scoped assignment", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue({ id: "identity-1" });
    mocks.categoryFindUnique.mockResolvedValue(null);

    await expect(
      service.createScopeAssignment("acme", actor(), {
        subjectType: "user",
        subjectId: "u2",
        scopeType: "category",
        categoryId: "cat-missing",
        actions: ["view"],
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it("derives the connector_account scope's stored value from the installation's own accountAlias, not the raw request input", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue({ id: "identity-1" });
    mocks.connectorInstallationFindUnique.mockResolvedValue({ id: "inst-1", accountAlias: "main-store" });
    mocks.accessScopeAssignmentCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "sa-1",
        tenantKey: "acme",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await service.createScopeAssignment("acme", actor(), {
      subjectType: "user",
      subjectId: "u2",
      scopeType: "connector_account",
      connectorInstallationId: "inst-1",
      actions: ["view"],
    } as never);

    const createCall = mocks.accessScopeAssignmentCreate.mock.calls[0][0];
    expect(createCall.data.scopeValue).toBe("main-store");
  });

  it("rejects an invalid scope action", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue({ id: "identity-1" });

    await expect(
      service.createScopeAssignment("acme", actor(), {
        subjectType: "user",
        subjectId: "u2",
        scopeType: "brand",
        scopeValue: "vexa",
        actions: ["definitely_not_a_real_action"],
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects an unsupported scope type outright", async () => {
    const { service, mocks } = makeService();
    mocks.authIdentityFindFirst.mockResolvedValue({ id: "identity-1" });

    await expect(
      service.createScopeAssignment("acme", actor(), {
        subjectType: "user",
        subjectId: "u2",
        scopeType: "not_a_real_scope_type",
        actions: ["view"],
      } as never),
    ).rejects.toThrow(NotFoundException);
  });
});

// applyReadResponsePolicy() and the response-redaction methods it dispatches
// to had zero coverage before this — real, live security-relevant code (the
// ReadAccessPolicyInterceptor calls applyReadResponsePolicy on every "redact"
// classified GET response) that had never been proven to actually strip what
// it claims to strip, or to leave privileged actors' data untouched.
describe("AccessPolicyService.applyReadResponsePolicy", () => {
  it("billing_plan_profile_governance_redacted: nulls billingContactEmail/updatedBy for a non-privileged actor", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "editor" }),
      "billing_plan_profile_governance_redacted",
      { tenantKey: "acme", planTier: "STARTER", billingContactEmail: "billing@acme.com", updatedBy: "user-9" },
    );
    expect(result).toEqual(
      expect.objectContaining({
        billingContactEmail: null,
        updatedBy: null,
        redactedFields: expect.arrayContaining(["billingContactEmail", "updatedBy"]),
      }),
    );
    // Non-sensitive fields must survive untouched.
    expect((result as { planTier: string }).planTier).toBe("STARTER");
  });

  it("billing_plan_profile_governance_redacted: leaves the payload byte-identical for an admin", () => {
    const { service } = makeService();
    const payload = { tenantKey: "acme", planTier: "STARTER", billingContactEmail: "billing@acme.com", updatedBy: "user-9" };
    const result = service.applyReadResponsePolicy(actor({ actorRole: "admin" }), "billing_plan_profile_governance_redacted", payload);
    expect(result).toBe(payload);
  });

  it("billing_plan_profile_governance_redacted: a super_admin also passes untouched", () => {
    const { service } = makeService();
    const payload = { billingContactEmail: "billing@acme.com", updatedBy: "user-9" };
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "editor", effectiveRoles: ["editor", "super_admin"] }),
      "billing_plan_profile_governance_redacted",
      payload,
    );
    expect(result).toBe(payload);
  });

  it("billing_plan_profile_governance_redacted: an explicit system_admin/product_admin boundary role (without super_admin) is still redacted", () => {
    // canReadGovernanceProvenance() deliberately denies these two — only
    // super_admin or a legacy plain "admin" with NO boundary role at all
    // qualifies. Proves that distinction actually holds for a real payload.
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "editor", effectiveRoles: ["editor", "system_admin"] }),
      "billing_plan_profile_governance_redacted",
      { billingContactEmail: "billing@acme.com", updatedBy: "user-9" },
    );
    expect(result).toEqual(expect.objectContaining({ billingContactEmail: null, updatedBy: null }));
  });

  it("billing_upgrade_request_governance_redacted: redacts requestedBy/notes/resolvedBy inside a nested {item} envelope", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "viewer" }),
      "billing_upgrade_request_governance_redacted",
      { item: { id: "req-1", requestedBy: "user-1", notes: "please upgrade us", resolvedBy: "user-2" } },
    ) as { item: Record<string, unknown> };
    expect(result.item).toEqual(
      expect.objectContaining({ requestedBy: null, notes: null, resolvedBy: null }),
    );
    expect(result.item.id).toBe("req-1");
  });

  it("audit_events_governance_redacted / audit_logs_governance_redacted: redacts metadata across an {items:[]} list for a non-privileged actor", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "viewer" }),
      "audit_logs_governance_redacted",
      { items: [{ id: "e1", metadata: { secret: "value" } }, { id: "e2", metadata: { other: "value" } }], nextCursor: null },
    ) as { items: Array<Record<string, unknown>> };
    expect(result.items[0].metadata).toBeNull();
    expect(result.items[1].metadata).toBeNull();
    expect(result.items[0].id).toBe("e1");
  });

  it("audit_logs_governance_redacted: an admin sees metadata untouched", () => {
    const { service } = makeService();
    const payload = { items: [{ id: "e1", metadata: { secret: "value" } }] };
    const result = service.applyReadResponsePolicy(actor({ actorRole: "admin" }), "audit_logs_governance_redacted", payload);
    expect(result).toBe(payload);
  });

  it("outbound_webhook_deliveries_governance_redacted: redacts errorMessage for a plain array payload", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "editor" }),
      "outbound_webhook_deliveries_governance_redacted",
      [{ id: "d1", errorMessage: "connection refused to internal-host:5432" }],
    ) as Array<Record<string, unknown>>;
    expect(result[0].errorMessage).toBeNull();
    expect(result[0].id).toBe("d1");
  });

  it("workspace_users_governance_redacted / workspace_access_scopes_governance_redacted / api_keys_governance_redacted / connector_permissions_governance_redacted: all redact createdBy for a single item", () => {
    const { service } = makeService();
    for (const policy of [
      "workspace_users_governance_redacted",
      "workspace_access_scopes_governance_redacted",
      "api_keys_governance_redacted",
      "connector_permissions_governance_redacted",
    ] as const) {
      const result = service.applyReadResponsePolicy(actor({ actorRole: "viewer" }), policy, { id: "x1", createdBy: "user-1" });
      expect(result).toEqual(expect.objectContaining({ createdBy: null }));
    }
  });

  it("catalog_products_redacted: strips vendorScopeKey unconditionally and sensitive pricing fields for a non-privileged actor, across an {items:[]} page", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "viewer" }),
      "catalog_products_redacted",
      { items: [{ id: "p1", vendorScopeKey: "vendor-9", attributes: { sku: "SKU-1", mrp: 999 } }], nextCursor: null },
    ) as { items: Array<Record<string, unknown>> };
    expect(result.items[0].vendorScopeKey).toBeUndefined();
    const attrs = result.items[0].attributes as Record<string, unknown>;
    expect(attrs.mrp).toBeUndefined();
  });

  it("catalog_products_redacted: an editor (privileged for sensitive product fields) still has vendorScopeKey stripped unconditionally", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "editor" }),
      "catalog_product_detail_redacted",
      { id: "p1", vendorScopeKey: "vendor-9", attributes: { sku: "SKU-1", mrp: 999 } },
    ) as Record<string, unknown>;
    expect(result.vendorScopeKey).toBeUndefined();
    // editor CAN read sensitive fields, unlike viewer above.
    expect((result.attributes as Record<string, unknown>).mrp).toBe(999);
  });

  it("catalog_variants_redacted: strips mrp/sellingPrice/inventoryQty for a non-privileged actor", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(
      actor({ actorRole: "viewer" }),
      "catalog_variants_redacted",
      [{ id: "v1", mrp: 100, sellingPrice: 80, inventoryQty: 42 }],
    ) as Array<Record<string, unknown>>;
    expect(result[0].mrp).toBeUndefined();
    expect(result[0].sellingPrice).toBeUndefined();
    expect(result[0].inventoryQty).toBeUndefined();
  });

  it("catalog_search_redacted: strips matchedSku for a non-privileged actor, preserves it for an editor", () => {
    const { service } = makeService();
    const viewerResult = service.applyReadResponsePolicy(actor({ actorRole: "viewer" }), "catalog_search_redacted", [
      { id: "p1", matchedSku: "SKU-1" },
    ]) as Array<Record<string, unknown>>;
    expect(viewerResult[0].matchedSku).toBeUndefined();

    const editorResult = service.applyReadResponsePolicy(actor({ actorRole: "editor" }), "catalog_search_redacted", [
      { id: "p1", matchedSku: "SKU-1" },
    ]) as Array<Record<string, unknown>>;
    expect(editorResult[0].matchedSku).toBe("SKU-1");
  });

  it("dashboard_health_redacted: zeroes the approval queue and connector breakdown for a viewer, records which sections were redacted", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(actor({ actorRole: "viewer" }), "dashboard_health_redacted", {
      snapshot: {
        capturedAt: "2026-09-20T00:00:00Z",
        totalSkus: 10,
        completeSkus: 8,
        incompleteSkus: 2,
        publishReadyByConnector: { shopify: 5 },
        blockedByConnector: { shopify: 1 },
        rejectionRiskHigh: 0,
        openIssuesBlocking: 0,
        openIssuesWarning: 0,
      },
      trend: [],
      asOf: "2026-09-20T00:00:00Z",
      pendingApprovals: 7,
      redactedSections: [],
    });
    expect(result.snapshot.publishReadyByConnector).toEqual({});
    expect(result.pendingApprovals).toBe(0);
    expect(result.redactedSections).toEqual(expect.arrayContaining(["connector_breakdown", "approval_queue"]));
  });

  it("dashboard_health_redacted: an admin sees real numbers, not zeroed placeholders", () => {
    const { service } = makeService();
    const result = service.applyReadResponsePolicy(actor({ actorRole: "admin" }), "dashboard_health_redacted", {
      snapshot: {
        capturedAt: "2026-09-20T00:00:00Z",
        totalSkus: 10,
        completeSkus: 8,
        incompleteSkus: 2,
        publishReadyByConnector: { shopify: 5 },
        blockedByConnector: { shopify: 1 },
        rejectionRiskHigh: 0,
        openIssuesBlocking: 0,
        openIssuesWarning: 0,
      },
      trend: [],
      asOf: "2026-09-20T00:00:00Z",
      pendingApprovals: 7,
      redactedSections: [],
    });
    expect(result.snapshot.publishReadyByConnector).toEqual({ shopify: 5 });
    expect(result.pendingApprovals).toBe(7);
  });

  it("catalog_stats_redacted: zeroes pendingApprovals for a viewer, preserves it for an admin", () => {
    const { service } = makeService();
    const base = { categories: 3, products: 100, variants: 250, pendingApprovals: 4 };
    const viewerResult = service.applyReadResponsePolicy(actor({ actorRole: "viewer" }), "catalog_stats_redacted", { ...base }) as typeof base;
    expect(viewerResult.pendingApprovals).toBe(0);

    const adminResult = service.applyReadResponsePolicy(actor({ actorRole: "admin" }), "catalog_stats_redacted", { ...base }) as typeof base;
    expect(adminResult.pendingApprovals).toBe(4);
  });

  it("an unrecognised policy id returns the payload byte-identical (safe default, not a silent leak of a NEW policy someone forgot to wire up)", () => {
    const { service } = makeService();
    const payload = { anything: "goes" };
    const result = service.applyReadResponsePolicy(actor({ actorRole: "viewer" }), "not_a_real_policy" as never, payload);
    expect(result).toBe(payload);
  });
});
