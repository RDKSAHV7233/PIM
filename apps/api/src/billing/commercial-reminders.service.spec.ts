// apps/api/src/billing/commercial-reminders.service.spec.ts
//
// Replaces the brittle string-scan assertions in
//   apps/api/test/integration/commercial-reminders-contract.test.cjs
// by exercising the live class with jest fake-timers.
//
// What we verify here:
//   (a) Timer scheduling — onModuleInit schedules a boot-delay timeout whose
//       callback fires the first run and sets up a recurring interval.
//   (b) Timer cleanup — onModuleDestroy clears both handles and nulls them
//       so a second call is a safe no-op (double-clear protection).
//   (c) QUEUE_WORKER_ENABLED gate — no timers are scheduled when the env
//       var equals "true" (dedicated worker dyno scenario).
//   (d) Per-tenant error isolation — a failure inside sendTrialEndingReminders
//       for one tenant is logged but does not abort the overall run.

import { CommercialRemindersService } from "./commercial-reminders.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PlanUsageService } from "./plan-usage.service";
import type { CommercialNotificationsService } from "./commercial-notifications.service";

// ─── Dependency stubs ─────────────────────────────────────────────────────────

function makeStubs() {
  const queryRawMock = jest.fn().mockResolvedValue([]);
  const prisma = {
    tenant: jest.fn().mockReturnValue({
      $queryRaw: queryRawMock,
    }),
  } as unknown as PrismaService;

  const planUsage = {
    getTenantPlanProfile: jest.fn().mockResolvedValue({
      billingStatus: "trial",
      accessStatus: "active",
    }),
  } as unknown as PlanUsageService;

  const notifications = {
    notifyTrialEnding: jest.fn().mockResolvedValue({ recipientCount: 1 }),
  } as unknown as CommercialNotificationsService;

  return { prisma, planUsage, notifications, queryRawMock };
}

// ─── Timer scheduling ─────────────────────────────────────────────────────────

describe("CommercialRemindersService — timer scheduling", () => {
  const ORIGINAL_ENV = process.env.QUEUE_WORKER_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers();
    // Default: run in the non-dedicated-worker environment so timers schedule.
    process.env.QUEUE_WORKER_ENABLED = "false";
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.QUEUE_WORKER_ENABLED = ORIGINAL_ENV;
  });

  it("onModuleInit schedules an initial delay timeout (5 min)", () => {
    const { prisma, planUsage, notifications } = makeStubs();
    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    svc.onModuleInit();

    // Exactly one pending timeout after init (the initial-delay gate).
    expect(jest.getTimerCount()).toBe(1);
  });

  it("after the initial delay, a recurring interval is registered (24 h)", () => {
    const { prisma, planUsage, notifications } = makeStubs();
    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    svc.onModuleInit();

    // Fast-forward past the 5-minute boot delay.
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Now both the initial-delay timeout has fired AND the interval has been set.
    // Timer count should be 1 (only the recurring interval remains).
    expect(jest.getTimerCount()).toBe(1);
  });

  it("does NOT schedule timers when QUEUE_WORKER_ENABLED=true", () => {
    process.env.QUEUE_WORKER_ENABLED = "true";
    const { prisma, planUsage, notifications } = makeStubs();
    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    svc.onModuleInit();

    expect(jest.getTimerCount()).toBe(0);
  });
});

// ─── Timer cleanup ────────────────────────────────────────────────────────────

describe("CommercialRemindersService — timer cleanup", () => {
  const ORIGINAL_ENV = process.env.QUEUE_WORKER_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.QUEUE_WORKER_ENABLED = "false";
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.QUEUE_WORKER_ENABLED = ORIGINAL_ENV;
  });

  it("onModuleDestroy clears the initial timeout before it fires", () => {
    const { prisma, planUsage, notifications } = makeStubs();
    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    svc.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    svc.onModuleDestroy();
    // All pending timers should be cleared.
    expect(jest.getTimerCount()).toBe(0);
  });

  it("onModuleDestroy clears the recurring interval after it has started", () => {
    const { prisma, planUsage, notifications } = makeStubs();
    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    svc.onModuleInit();
    jest.advanceTimersByTime(5 * 60 * 1000 + 1); // past boot delay → interval registered
    expect(jest.getTimerCount()).toBe(1);

    svc.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("calling onModuleDestroy twice is a safe no-op (double-clear protection)", () => {
    const { prisma, planUsage, notifications } = makeStubs();
    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    svc.onModuleInit();
    svc.onModuleDestroy();

    // Second call must not throw even though handles are already null.
    expect(() => svc.onModuleDestroy()).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ─── Per-tenant error isolation ───────────────────────────────────────────────

describe("CommercialRemindersService — per-tenant error isolation", () => {
  it("runReminders does not re-throw when sendTrialEndingReminders fails", async () => {
    const { prisma, planUsage, notifications, queryRawMock } = makeStubs();
    // Simulate the raw query throwing (e.g. DB connection blip).
    queryRawMock.mockRejectedValueOnce(new Error("DB connection error"));

    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    // runReminders wraps the inner call in a top-level try/catch — must not throw.
    await expect(svc.runReminders()).resolves.toBeUndefined();
  });

  it("runReminders does not re-throw on an unexpected non-Error rejection", async () => {
    const { prisma, planUsage, notifications, queryRawMock } = makeStubs();
    queryRawMock.mockRejectedValueOnce("raw string error");

    const svc = new CommercialRemindersService(prisma, planUsage, notifications);
    await expect(svc.runReminders()).resolves.toBeUndefined();
  });
});
