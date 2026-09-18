import { QUEUE_NAMES } from "../queue/queue.constants";
import { SignupService } from "./signup.service";

/**
 * H-3: a billing dependency being down while the verification link is clicked must
 * not strand the user. verifyPublicSignup must still commit the workspace + mark the
 * request verified + return the success response, and hand the billing work to the
 * SIGNUP_BILLING_PROVISION retry queue instead of throwing a 500.
 */
describe("SignupService.verifyPublicSignup billing isolation (H-3)", () => {
  const ORIGINAL_ENV = process.env;
  const TOKEN = "a".repeat(48);

  let signupRequestStore: {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  let prisma: { tenant: jest.Mock };
  let tenantDirectoryService: { provisionWorkspaceWithPasswordHash: jest.Mock };
  let authEmailService: { send: jest.Mock };
  let planUsageService: { initializeTrialPlanProfile: jest.Mock };
  let metricsService: { emit: jest.Mock };
  let stripeService: { createCustomerAndSubscription: jest.Mock };
  let queueService: { process: jest.Mock; enqueue: jest.Mock };

  function makeService(): SignupService {
    return new SignupService(
      prisma as never,
      tenantDirectoryService as never,
      authEmailService as never,
      planUsageService as never,
      metricsService as never,
      stripeService as never,
      queueService as never,
    );
  }

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, FEATURE_PUBLIC_SIGNUP_ENABLED: "true" };

    signupRequestStore = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({
        id: "signup_test_1",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        workspaceSlug: "acme",
        displayName: "Acme",
        adminEmail: "admin@acme.example",
        passwordHash: "hash",
        createdAt: new Date(Date.now() - 60_000),
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma = { tenant: jest.fn().mockReturnValue({ publicSignupRequest: signupRequestStore }) };
    tenantDirectoryService = {
      provisionWorkspaceWithPasswordHash: jest
        .fn()
        .mockResolvedValue({ tenantId: "acme", workspaceSlug: "acme" }),
    };
    authEmailService = { send: jest.fn().mockResolvedValue(undefined) };
    planUsageService = { initializeTrialPlanProfile: jest.fn().mockResolvedValue({ planTier: "TRIAL" }) };
    metricsService = { emit: jest.fn().mockResolvedValue(undefined) };
    stripeService = { createCustomerAndSubscription: jest.fn().mockResolvedValue(undefined) };
    queueService = { process: jest.fn(), enqueue: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("returns the verified response and does not enqueue a retry on the happy path", async () => {
    const service = makeService();

    const result = await service.verifyPublicSignup(TOKEN);

    expect(result).toEqual({
      ok: true,
      status: "verified",
      workspaceSlug: "acme",
      userId: "admin@acme.example",
    });
    expect(stripeService.createCustomerAndSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ tenantKey: "acme", planTier: "TRIAL", idempotencyKey: "signup-trial:acme" }),
    );
    expect(queueService.enqueue).not.toHaveBeenCalled();
    // request marked verified
    expect(signupRequestStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "verified" }) }),
    );
  });

  it("still returns 'verified' and enqueues a retry when plan-profile seeding fails", async () => {
    planUsageService.initializeTrialPlanProfile.mockRejectedValueOnce(new Error("db timeout"));
    const service = makeService();

    const result = await service.verifyPublicSignup(TOKEN);

    expect(result.status).toBe("verified");
    expect(result.workspaceSlug).toBe("acme");
    expect(signupRequestStore.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "verified" }) }),
    );
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      QUEUE_NAMES.SIGNUP_BILLING_PROVISION,
      {
        tenantKey: "acme",
        adminEmail: "admin@acme.example",
        displayName: "Acme",
        planTier: "TRIAL",
        signupRequestId: "signup_test_1",
      },
      { jobId: "signup-billing:acme" },
    );
  });

  it("still returns 'verified' and enqueues a retry when the Stripe call fails", async () => {
    stripeService.createCustomerAndSubscription.mockRejectedValueOnce(new Error("stripe 503"));
    const service = makeService();

    const result = await service.verifyPublicSignup(TOKEN);

    expect(result.status).toBe("verified");
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("does not throw out of verify even if enqueueing the retry itself fails", async () => {
    planUsageService.initializeTrialPlanProfile.mockRejectedValueOnce(new Error("db timeout"));
    queueService.enqueue.mockRejectedValueOnce(new Error("redis down"));
    const service = makeService();

    await expect(service.verifyPublicSignup(TOKEN)).resolves.toEqual(
      expect.objectContaining({ status: "verified" }),
    );
  });

  it("registers the SIGNUP_BILLING_PROVISION consumer on module init", () => {
    const service = makeService();

    service.onModuleInit();

    expect(queueService.process).toHaveBeenCalledWith(
      QUEUE_NAMES.SIGNUP_BILLING_PROVISION,
      expect.any(Function),
    );
  });

  it("the retry consumer runs the idempotent billing path", async () => {
    const service = makeService();
    service.onModuleInit();
    const handler = queueService.process.mock.calls[0][1] as (payload: unknown) => Promise<void>;

    await expect(
      handler({
        tenantKey: "acme",
        adminEmail: "admin@acme.example",
        displayName: "Acme",
        planTier: "TRIAL",
        signupRequestId: "signup_test_1",
      }),
    ).resolves.toBeUndefined();

    expect(planUsageService.initializeTrialPlanProfile).toHaveBeenCalledWith("acme");
    expect(stripeService.createCustomerAndSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "signup-trial:acme" }),
    );
  });

  it("the retry consumer rethrows on failure so the queue can retry", async () => {
    stripeService.createCustomerAndSubscription.mockRejectedValueOnce(new Error("stripe 503"));
    const service = makeService();
    service.onModuleInit();
    const handler = queueService.process.mock.calls[0][1] as (payload: unknown) => Promise<void>;

    await expect(
      handler({
        tenantKey: "acme",
        adminEmail: "admin@acme.example",
        displayName: "Acme",
        planTier: "TRIAL",
        signupRequestId: "signup_test_1",
      }),
    ).rejects.toThrow("stripe 503");
  });
});
