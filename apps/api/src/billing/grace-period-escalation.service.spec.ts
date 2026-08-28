import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { GracePeriodEscalationService } from "./grace-period-escalation.service";

jest.mock("../common/scheduling/advisory-lock", () => ({
  runWithAdvisoryLock: jest.fn(),
}));

function makeService() {
  const prisma = {
    tenant: jest.fn().mockReturnValue({
      $queryRaw: jest.fn().mockResolvedValue([]),
    }),
  };
  const planUsageService = {
    updateCommercialStateForTenant: jest.fn(),
  };
  const commercialNotificationsService = {
    notifyTenantAdmins: jest.fn(),
  };
  const auditService = {
    record: jest.fn(),
  };
  const service = new GracePeriodEscalationService(
    prisma as never,
    planUsageService as never,
    commercialNotificationsService as never,
    auditService as never,
  );
  return { service, prisma };
}

const mockedRunWithAdvisoryLock = runWithAdvisoryLock as jest.MockedFunction<typeof runWithAdvisoryLock>;
const ORIGINAL_ENV = process.env;

describe("GracePeriodEscalationService scheduler lock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, QUEUE_WORKER_ENABLED: "true" };
    mockedRunWithAdvisoryLock.mockImplementation(async (_lockName, fn) => {
      await fn();
      return true;
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("routes both initial and recurring timer ticks through the same lock-guarded entry point", () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const scheduledSpy = jest
      .spyOn(service as unknown as { runScheduledEscalation: () => Promise<void> }, "runScheduledEscalation")
      .mockResolvedValue(undefined);

    service.onModuleInit();
    jest.advanceTimersByTime(3 * 60 * 1000 + 1);

    expect(scheduledSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(6 * 60 * 60 * 1000);

    expect(scheduledSpy).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it("uses the grace-period-escalation advisory lock before running the job body", async () => {
    const { service, prisma } = makeService();

    await (service as unknown as { runScheduledEscalation: () => Promise<void> }).runScheduledEscalation();

    expect(mockedRunWithAdvisoryLock).toHaveBeenCalledWith("grace-period-escalation", expect.any(Function));
    expect(prisma.tenant).toHaveBeenCalled();
  });

  it("does not run unlocked when the lock infrastructure fails", async () => {
    const { service, prisma } = makeService();
    const loggerErrorSpy = jest
      .spyOn((service as unknown as { logger: { error: (message: string) => void } }).logger, "error")
      .mockImplementation(() => undefined);
    mockedRunWithAdvisoryLock.mockRejectedValueOnce(new Error("lock database unavailable"));

    await expect(
      (service as unknown as { runScheduledEscalation: () => Promise<void> }).runScheduledEscalation(),
    ).resolves.toBeUndefined();

    expect(prisma.tenant).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Scheduler lock failure for grace-period-escalation"),
    );
  });

  it("skips without running the body when another replica holds the lock", async () => {
    const { service, prisma } = makeService();
    mockedRunWithAdvisoryLock.mockResolvedValueOnce(false);

    await (service as unknown as { runScheduledEscalation: () => Promise<void> }).runScheduledEscalation();

    expect(prisma.tenant).not.toHaveBeenCalled();
  });
});
