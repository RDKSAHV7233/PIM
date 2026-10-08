import { StripeService } from "./stripe.service";

/**
 * H-3: provisioning the signup trial must be safe to run more than once (a retry
 * after a Stripe timeout, or the SIGNUP_BILLING_PROVISION queue re-running the same
 * job). Two runs must yield exactly one Stripe customer and one subscription.
 */
describe("StripeService.createCustomerAndSubscription idempotency (H-3)", () => {
  const ORIGINAL_ENV = process.env;
  let stored: { externalCustomerId: string | null; externalSubscriptionId: string | null };
  let customersCreate: jest.Mock;
  let subscriptionsCreate: jest.Mock;

  function makeService(): StripeService {
    const prisma = { tenant: jest.fn() };
    const service = new StripeService(prisma as never, { getClient: jest.fn() } as never);

    jest
      .spyOn(service as unknown as { getClient: () => unknown }, "getClient")
      .mockReturnValue({
        customers: { create: customersCreate },
        subscriptions: { create: subscriptionsCreate },
      });
    jest
      .spyOn(service as unknown as { getStoredIds: (key: string) => Promise<typeof stored> }, "getStoredIds")
      .mockImplementation(async () => ({ ...stored }));
    jest
      .spyOn(
        service as unknown as {
          storeExternalIds: (key: string, customerId: string | null, subscriptionId: string | null) => Promise<void>;
        },
        "storeExternalIds",
      )
      .mockImplementation(async (_key, customerId, subscriptionId) => {
        if (customerId) stored.externalCustomerId = customerId;
        if (subscriptionId) stored.externalSubscriptionId = subscriptionId;
      });

    return service;
  }

  const baseInput = {
    tenantKey: "acme",
    adminEmail: "admin@acme.example",
    displayName: "Acme",
    planTier: "STARTER",
  };

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      FEATURE_STRIPE_BILLING_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PRICE_ID_STARTER: "price_starter_test",
    };
    stored = { externalCustomerId: null, externalSubscriptionId: null };
    customersCreate = jest.fn().mockResolvedValue({ id: "cus_test_1" });
    subscriptionsCreate = jest.fn().mockResolvedValue({ id: "sub_test_1" });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("creates exactly one customer and one subscription when provisioning runs twice", async () => {
    const service = makeService();

    await service.createCustomerAndSubscription(baseInput);
    await service.createCustomerAndSubscription(baseInput);

    expect(customersCreate).toHaveBeenCalledTimes(1);
    expect(subscriptionsCreate).toHaveBeenCalledTimes(1);
    expect(stored).toEqual({
      externalCustomerId: "cus_test_1",
      externalSubscriptionId: "sub_test_1",
    });
  });

  it("short-circuits without calling Stripe once both ids are already stored", async () => {
    const service = makeService();
    stored = { externalCustomerId: "cus_existing", externalSubscriptionId: "sub_existing" };

    await service.createCustomerAndSubscription(baseInput);

    expect(customersCreate).not.toHaveBeenCalled();
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });

  it("passes a stable signup-trial idempotency key to the Stripe create calls", async () => {
    const service = makeService();

    await service.createCustomerAndSubscription(baseInput);

    expect(customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ tenantKey: "acme" }) }),
      expect.objectContaining({ idempotencyKey: "signup-trial:acme:customer" }),
    );
    expect(subscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_test_1" }),
      expect.objectContaining({ idempotencyKey: "signup-trial:acme:subscription" }),
    );
  });

  it("honours an explicit idempotencyKey override", async () => {
    const service = makeService();

    await service.createCustomerAndSubscription({ ...baseInput, idempotencyKey: "custom-key" });

    expect(customersCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: "custom-key:customer" }),
    );
  });

  it("still returns without creating anything for a TRIAL tier (unchanged behaviour)", async () => {
    const service = makeService();

    await service.createCustomerAndSubscription({ ...baseInput, planTier: "TRIAL" });

    expect(customersCreate).not.toHaveBeenCalled();
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });
});

// ---- SEC-DB-RLS-001: the webhook's customer-to-tenant lookup reads every tenant ------------------------------------------------------------
// The fake direct client is RLS-faithful: a query sees only profiles of the tenant context set by the iteration, and the context-free
// client (this.prisma.tenant()) sees the default tenant only, as a restricted role would.
describe("StripeService.resolveTenantKeyFromCustomerId — per-tenant lookup (SEC-DB-RLS-001)", () => {
  type Profile = { tenantKey: string; externalCustomerId: string };

  function makeService(profiles: Profile[], options: { directory?: string[]; failTenant?: string; orphan?: Profile } = {}) {
    const direct = {
      workspaceDirectory: { findMany: jest.fn().mockResolvedValue((options.directory ?? []).map((tenantKey) => ({ tenantKey }))) },
      // each transaction has its own tenant context, as a real connection does (the iteration runs several at once)
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        let context = "";
        const tx = {
          $queryRaw: async (arg: unknown, ...values: unknown[]) => {
            if (Array.isArray(arg)) {
              // set_config tagged template from forEachTenant: the first interpolated value is the tenant
              context = String(values[0]);
              return [];
            }
            const [tenantKey, customerId] = (arg as { values: unknown[] }).values as [string, string];
            if (options.failTenant === tenantKey) {
              throw Object.assign(new Error("connection postgres://u:SECRET@h/db reset"), { code: "P1001" });
            }
            return profiles
              .filter((p) => p.tenantKey === context && p.tenantKey === tenantKey && p.externalCustomerId === customerId)
              .map((p) => ({ tenantKey: p.tenantKey }));
          },
        };
        return fn(tx);
      }),
    };
    const contextFree = {
      $queryRaw: jest.fn(async (arg: unknown) => {
        const customerId = (arg as { values: unknown[] }).values[0];
        const all = options.orphan ? [...profiles, options.orphan] : profiles;
        // restricted role: default tenant only (an orphan is invisible); today's superuser role would see the orphan
        return all.filter((p) => p.tenantKey === "default" && p.externalCustomerId === customerId).map((p) => ({ tenantKey: p.tenantKey }));
      }),
    };
    const prisma = { tenant: jest.fn(() => contextFree) };
    const service = new StripeService(prisma as never, { getClient: () => direct } as never);
    return { service, direct, contextFree };
  }

  const profiles: Profile[] = [
    { tenantKey: "default", externalCustomerId: "cus_default" },
    { tenantKey: "tenant-b", externalCustomerId: "cus_b" },
    { tenantKey: "tenant-c", externalCustomerId: "cus_c" },
  ];

  it("resolves a non-default tenant's customer to that tenant (the silently dropped webhook)", async () => {
    const { service } = makeService(profiles, { directory: ["tenant-b", "tenant-c"] });
    await expect(service.resolveTenantKeyFromCustomerId("cus_b")).resolves.toBe("tenant-b");
    await expect(service.resolveTenantKeyFromCustomerId("cus_c")).resolves.toBe("tenant-c");
    await expect(service.resolveTenantKeyFromCustomerId("cus_default")).resolves.toBe("default");
  });

  it("returns null for an unknown customer when every tenant was readable", async () => {
    const { service } = makeService(profiles, { directory: ["tenant-b", "tenant-c"] });
    await expect(service.resolveTenantKeyFromCustomerId("cus_unknown")).resolves.toBeNull();
  });

  it("returns null for a blank customer id without querying", async () => {
    const { service, direct } = makeService(profiles, { directory: ["tenant-b"] });
    await expect(service.resolveTenantKeyFromCustomerId("  ")).resolves.toBeNull();
    expect(direct.$transaction).not.toHaveBeenCalled();
  });

  it("an unreadable tenant with no match throws (so the webhook fails and Stripe retries) instead of reporting no tenant", async () => {
    const { service } = makeService(profiles, { directory: ["tenant-b", "tenant-c"], failTenant: "tenant-b" });
    const error = await service.resolveTenantKeyFromCustomerId("cus_unknown").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("STRIPE_CUSTOMER_TENANT_READ_FAILED");
    expect((error as Error).message).toContain("tenant-b:P1001");
    expect((error as Error).message).not.toContain("SECRET");
  });

  it("a match in a readable tenant is returned although another tenant is unreadable", async () => {
    const { service } = makeService(profiles, { directory: ["tenant-b", "tenant-c"], failTenant: "tenant-b" });
    await expect(service.resolveTenantKeyFromCustomerId("cus_c")).resolves.toBe("tenant-c");
  });

  it("two tenants carrying the same customer id is a data fault and throws", async () => {
    const dup = [...profiles, { tenantKey: "tenant-c", externalCustomerId: "cus_b" }];
    const { service } = makeService(dup, { directory: ["tenant-b", "tenant-c"] });
    await expect(service.resolveTenantKeyFromCustomerId("cus_b")).rejects.toThrow("STRIPE_CUSTOMER_TENANT_AMBIGUOUS");
  });

  it("still finds a tenant with a profile but no directory row through the best-effort context-free step", async () => {
    // today's role bypasses row level security and sees the orphan; modelled by a context-free client that returns it
    const orphan = { tenantKey: "default", externalCustomerId: "cus_orphan" };
    const { service } = makeService(profiles, { directory: ["tenant-b"], orphan });
    await expect(service.resolveTenantKeyFromCustomerId("cus_orphan")).resolves.toBe("default");
  });
});
