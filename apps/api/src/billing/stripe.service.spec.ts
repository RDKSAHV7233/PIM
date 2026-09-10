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
    const service = new StripeService(prisma as never);

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
