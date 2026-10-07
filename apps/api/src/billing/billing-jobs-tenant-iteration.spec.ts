// SEC-DB-RLS-001 I-3: the two scheduled billing jobs must reach EVERY tenant.
//
// Each case follows one rule: the fixture proves there is something to do (a non-default tenant that must be suspended or reminded),
// the job DISCOVERS it, and the job ACTS on it. A run that finds zero rows when the fixture says at least one exists must fail, so
// "no error" can never stand in for "it worked". Every scenario runs twice, with row level security enforced and with it bypassed
// (the production role today), and must give the same answer in both.

import { Logger } from "@nestjs/common";
import { GracePeriodEscalationService } from "./grace-period-escalation.service";
import { CommercialRemindersService } from "./commercial-reminders.service";
import { makeFakeProfileDb, type ProfileRow } from "./fake-plan-profile-db-spec";

const DAY = 24 * 60 * 60 * 1000;
const MODES = ["restricted", "superuser"] as const;

describe.each(MODES)("grace-period escalation reaches every tenant (%s)", (mode) => {
  const past = () => new Date(Date.now() - DAY);
  const future = () => new Date(Date.now() + 3 * DAY);
  const pastDue = (tenantKey: string, graceEndsAt: Date, accessStatus = "active"): ProfileRow => ({ tenantKey, billingStatus: "past_due", accessStatus, graceEndsAt });

  function build(rows: ProfileRow[], directory: string[]) {
    const db = makeFakeProfileDb(rows, directory, mode);
    const prisma = { tenant: jest.fn(() => db.base) };
    const profile = { billingStatus: "past_due", accessStatus: "suspended" };
    const planUsage = { updateCommercialStateForTenant: jest.fn().mockResolvedValue(profile) };
    const notifications = { notifyTenantAdmins: jest.fn().mockResolvedValue(undefined) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new GracePeriodEscalationService(prisma as never, planUsage as never, notifications as never, audit as never);
    return { service, db, planUsage, notifications, audit };
  }

  const fixture = () => [
    pastDue("tenant-a", past()),
    pastDue("tenant-b", past()),
    pastDue("default", past()),
    pastDue("tenant-grace-left", future()), // grace period not over yet
    pastDue("tenant-already", past(), "suspended"), // already suspended
    { tenantKey: "tenant-paid", billingStatus: "active", accessStatus: "active", graceEndsAt: past() } as ProfileRow, // paying
  ];
  const directory = ["tenant-a", "tenant-b", "tenant-grace-left", "tenant-already", "tenant-paid"];

  afterEach(() => jest.restoreAllMocks());

  it("discovers and suspends every NON-DEFAULT tenant whose grace period expired, each exactly once", async () => {
    const { service, planUsage, notifications, audit } = build(fixture(), directory);

    const result = await service.runEscalation();

    expect(result).toBeDefined();
    expect(result!.discovered).toBe(3); // the fixture has exactly three expired tenants: a, b, default
    expect(result!.suspended).toBe(3);
    expect(result!.failed).toBe(0);
    expect(result!.status).toBe("SUCCESS");
    const suspendedTenants = planUsage.updateCommercialStateForTenant.mock.calls.map((c) => c[0]).sort();
    expect(suspendedTenants).toEqual(["default", "tenant-a", "tenant-b"]); // exactly once each: no duplicate per iteration
    expect(notifications.notifyTenantAdmins).toHaveBeenCalledTimes(3);
    expect(audit.record).toHaveBeenCalledTimes(3);
    expect(planUsage.updateCommercialStateForTenant.mock.calls.find((c) => c[0] === "tenant-a")![1]).toMatchObject({ accessStatus: "suspended", suspensionReason: "grace_period_expired" });
  });

  it("does not touch a tenant whose grace period is not over, one that is already suspended, or one that is paying", async () => {
    const { service, planUsage } = build(fixture(), directory);
    await service.runEscalation();
    const touched = planUsage.updateCommercialStateForTenant.mock.calls.map((c) => c[0]);
    for (const untouched of ["tenant-grace-left", "tenant-already", "tenant-paid"]) {
      expect(touched).not.toContain(untouched);
    }
  });

  it("a fixture with NO expired tenant discovers nothing and reports SUCCESS (so a zero result is only accepted when it is true)", async () => {
    const { service, planUsage } = build([pastDue("tenant-a", future())], ["tenant-a"]);
    const result = await service.runEscalation();
    expect(result).toMatchObject({ discovered: 0, suspended: 0, status: "SUCCESS" });
    expect(planUsage.updateCommercialStateForTenant).not.toHaveBeenCalled();
  });

  it("MUTATION: the old single unscoped scan, on the same fixture, under RLS finds only the default tenant", async () => {
    // What the job used to do: one query through the base client, no tenant iteration.
    const { db } = build(fixture(), directory);
    const legacy = await db.base.$queryRaw({ sql: 'SELECT "tenantKey", "graceEndsAt" FROM "TenantPlanProfile" WHERE "graceEndsAt" < $1', values: [new Date()] });
    const found = (legacy as Array<{ tenantKey: string }>).map((r) => r.tenantKey).sort();
    if (mode === "restricted") {
      expect(found).toEqual(["default"]); // silently one tenant: the failure this change removes
    } else {
      expect(found.length).toBeGreaterThan(1); // superuser: it saw everyone, which is why nothing failed in production
    }
  });

  it("a failing suspension is an ERROR (an unpaid tenant stayed active), the other tenants are still suspended, and the status is PARTIAL_FAILURE", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { service, planUsage } = build(fixture(), directory);
    planUsage.updateCommercialStateForTenant.mockImplementation(async (tenantKey: string) => {
      if (tenantKey === "tenant-b") {
        throw new Error("write failed");
      }
      return { billingStatus: "past_due", accessStatus: "suspended" };
    });

    const result = await service.runEscalation();

    expect(result).toMatchObject({ discovered: 3, suspended: 2, failed: 1, status: "PARTIAL_FAILURE" });
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("Failed to suspend tenant tenant-b"))).toBe(true);
  });

  it("a tenant that could not be READ is reported loudly and the run is PARTIAL_FAILURE, never a quiet success", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { service, db, planUsage } = build(fixture(), directory);
    db.failTenants.add("tenant-b");

    const result = await service.runEscalation();

    expect(result!.status).toBe("PARTIAL_FAILURE");
    expect(result!.discovery.tenantsFailed).toBe(1);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("could not check 1/"))).toBe(true);
    const touched = planUsage.updateCommercialStateForTenant.mock.calls.map((c) => c[0]);
    expect(touched).toContain("tenant-a"); // the readable tenants are still handled
    expect(touched).not.toContain("tenant-b");
  });
});

describe.each(MODES)("trial-ending reminders reach every tenant (%s)", (mode) => {
  const inDays = (days: number) => new Date(Date.now() + days * DAY);
  const trial = (tenantKey: string, trialEndsAt: Date): ProfileRow => ({ tenantKey, billingStatus: "trial", accessStatus: "active", trialEndsAt, billingContactEmail: `${tenantKey}@example.test` });

  function build(rows: ProfileRow[], directory: string[]) {
    const db = makeFakeProfileDb(rows, directory, mode);
    const upserts: Array<{ tenant: string; id: string }> = [];
    const notificationClient = (tenant: string) => ({
      authIdentity: { findMany: jest.fn().mockResolvedValue([{ userId: `admin@${tenant}` }]) },
      userNotification: { upsert: jest.fn(async ({ where }: { where: { id: string } }) => { upserts.push({ tenant, id: where.id }); return {}; }) },
    });
    const prisma = { tenant: jest.fn((tenant?: string) => (tenant ? notificationClient(tenant) : db.base)) };
    const planUsage = { getTenantPlanProfile: jest.fn().mockResolvedValue({ billingStatus: "trial", accessStatus: "active" }) };
    const notifications = { notifyTrialEnding: jest.fn().mockResolvedValue({ recipientCount: 1 }) };
    const service = new CommercialRemindersService(prisma as never, planUsage as never, notifications as never);
    return { service, db, planUsage, notifications, upserts };
  }

  // 6.5 days left rounds up to 7 (email and in-app); 12 hours left rounds up to 1 (email only); 4 days left is not a threshold.
  const fixture = () => [trial("tenant-a", inDays(6.5)), trial("tenant-b", inDays(0.5)), trial("tenant-far", inDays(4)), trial("default", inDays(6.5)), trial("tenant-late", inDays(20))];
  const directory = ["tenant-a", "tenant-b", "tenant-far", "tenant-late"];

  const run = (service: CommercialRemindersService) => (service as unknown as { sendTrialEndingReminders: () => Promise<any> }).sendTrialEndingReminders();

  afterEach(() => jest.restoreAllMocks());

  it("discovers and reminds every non-default tenant at a threshold, once each, and creates the in-app notification where the schedule says so", async () => {
    const { service, notifications, upserts } = build(fixture(), directory);

    const result = await run(service);

    expect(result.discovered).toBe(4); // a, b, far and default are inside the 8-day window; tenant-late is not
    expect(result.eligible).toBe(3); // a (7 days), b (1 day), default (7 days)
    expect(result.acted).toBe(3);
    expect(result.emailsSent).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.status).toBe("SUCCESS");
    const emailed = notifications.notifyTrialEnding.mock.calls.map((c) => c[0].tenantKey).sort();
    expect(emailed).toEqual(["default", "tenant-a", "tenant-b"]);
    expect(notifications.notifyTrialEnding.mock.calls.find((c) => c[0].tenantKey === "tenant-a")![0].daysRemaining).toBe(7);
    expect(notifications.notifyTrialEnding.mock.calls.find((c) => c[0].tenantKey === "tenant-b")![0].daysRemaining).toBe(1);
    // In-app notifications: 7 days is a notification threshold (7, 2), 1 day is not.
    expect(upserts.map((u) => u.tenant).sort()).toEqual(["default", "tenant-a"]);
    expect(upserts.every((u) => u.id.includes(`.${u.tenant}.`))).toBe(true);
  });

  it("does not remind a tenant that is not at a threshold or whose trial is outside the window", async () => {
    const { service, notifications } = build(fixture(), directory);
    await run(service);
    const emailed = notifications.notifyTrialEnding.mock.calls.map((c) => c[0].tenantKey);
    expect(emailed).not.toContain("tenant-far");
    expect(emailed).not.toContain("tenant-late");
  });

  it("a fixture with no trial in the window discovers nothing and reports SUCCESS", async () => {
    const { service, notifications } = build([trial("tenant-late", inDays(20))], ["tenant-late"]);
    const result = await run(service);
    expect(result).toMatchObject({ discovered: 0, eligible: 0, acted: 0, status: "SUCCESS" });
    expect(notifications.notifyTrialEnding).not.toHaveBeenCalled();
  });

  it("MUTATION: the old single unscoped scan, on the same fixture, under RLS finds only the default tenant", async () => {
    const { db } = build(fixture(), directory);
    const legacy = await db.base.$queryRaw({ sql: 'SELECT "tenantKey", "trialEndsAt" FROM "TenantPlanProfile" WHERE "trialEndsAt" > $1 AND "trialEndsAt" <= $2', values: [new Date(), inDays(8)] });
    const found = (legacy as Array<{ tenantKey: string }>).map((r) => r.tenantKey);
    if (mode === "restricted") {
      expect(found).toEqual(["default"]);
    } else {
      expect(found.length).toBeGreaterThan(1);
    }
  });

  it("a reminder that fails is an ERROR (a missed commercial touchpoint), the other tenants are still reminded, and the status is PARTIAL_FAILURE", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { service, notifications } = build(fixture(), directory);
    notifications.notifyTrialEnding.mockImplementation(async ({ tenantKey }: { tenantKey: string }) => {
      if (tenantKey === "tenant-b") {
        throw new Error("mail provider down");
      }
      return { recipientCount: 1 };
    });

    const result = await run(service);

    expect(result).toMatchObject({ eligible: 3, acted: 2, failed: 1, status: "PARTIAL_FAILURE" });
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("Trial ending reminder failed for tenant-b"))).toBe(true);
  });

  it("a tenant that could not be READ is reported loudly and the run is PARTIAL_FAILURE", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { service, db } = build(fixture(), directory);
    db.failTenants.add("tenant-a");

    const result = await run(service);

    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(result.discovery.tenantsFailed).toBe(1);
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("could not check 1/"))).toBe(true);
  });

  it("runReminders still resolves to undefined and never rethrows (the scheduler must not crash the process)", async () => {
    const { service, db } = build(fixture(), directory);
    db.base.workspaceDirectory.findMany.mockRejectedValueOnce(new Error("directory unavailable"));
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    await expect(service.runReminders()).resolves.toBeUndefined();
  });
});
