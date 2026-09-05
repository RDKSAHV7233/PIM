// Focused coverage for CommercialNotificationsService.notifyCommercialOpsOverageFlag —
// deliberately its own method, not a reuse of notifyCommercialOpsUpgradeRequest, because that
// one's copy ("Upgrade request: {name}" / "{requestedBy} requested a commercial plan review")
// narrates a tenant-initiated request. Reusing it verbatim for a system-detected overage flag
// would misrepresent what happened to the person reading the email.
import { CommercialNotificationsService } from "./commercial-notifications.service";
import type { CommercialRequestSummary } from "./commercial-requests.service";

function makeRequest(overrides: Partial<CommercialRequestSummary> = {}): CommercialRequestSummary {
  return {
    id: "req_1",
    tenantKey: "acme",
    workspaceSlug: "acme",
    displayName: "Acme Corp",
    requestType: "users_limit_overage",
    status: "open",
    requestedBy: "system",
    requesterRole: "system",
    currentPlanTier: "ENTERPRISE",
    requestedPlanTier: null,
    currentBillingStatus: "active_paid",
    currentAccessStatus: "active",
    notes: null,
    source: "sso_auto_provisioning",
    usageSnapshot: { resource: "users", current: 1000, limit: 999 },
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeService() {
  const send = jest.fn().mockResolvedValue(undefined);
  const authEmailService = { send };
  const prisma = { tenant: jest.fn() };
  const service = new CommercialNotificationsService(prisma as never, authEmailService as never);
  return { service, send };
}

describe("CommercialNotificationsService.notifyCommercialOpsOverageFlag", () => {
  const originalEnv = process.env.PIM_COMMERCIAL_CONTACT_EMAIL;

  beforeEach(() => {
    process.env.PIM_COMMERCIAL_CONTACT_EMAIL = "commercial-ops@vexapim.com";
  });

  afterAll(() => {
    process.env.PIM_COMMERCIAL_CONTACT_EMAIL = originalEnv;
  });

  it("sends to the commercial contact with a subject and body that clearly describe an overage, not an upgrade request", async () => {
    const { service, send } = makeService();

    await service.notifyCommercialOpsOverageFlag({ tenantKey: "acme", request: makeRequest() });

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0] as { to: string; subject: string; text: string; category: string };
    expect(call.to).toBe("commercial-ops@vexapim.com");
    expect(call.subject).toBe("Plan limit exceeded: Acme Corp");
    expect(call.subject).not.toMatch(/upgrade request/i);
    expect(call.text).not.toMatch(/requested a commercial plan review/i);
    expect(call.category).toBe("commercial_overage_flag");
  });

  it("includes the resource, current usage, and limit from usageSnapshot in the email body", async () => {
    const { service, send } = makeService();

    await service.notifyCommercialOpsOverageFlag({
      tenantKey: "acme",
      request: makeRequest({ usageSnapshot: { resource: "users", current: 1000, limit: 999 } }),
    });

    const call = send.mock.calls[0][0] as { text: string };
    expect(call.text).toMatch(/users/);
    expect(call.text).toMatch(/1000/);
    expect(call.text).toMatch(/999/);
  });

  it("explicitly states no customer action was blocked", async () => {
    const { service, send } = makeService();

    await service.notifyCommercialOpsOverageFlag({ tenantKey: "acme", request: makeRequest() });

    const call = send.mock.calls[0][0] as { text: string };
    expect(call.text).toMatch(/no customer action was blocked/i);
  });

  it("no-ops (sends nothing) when PIM_COMMERCIAL_CONTACT_EMAIL is not configured", async () => {
    delete process.env.PIM_COMMERCIAL_CONTACT_EMAIL;
    const { service, send } = makeService();

    const result = await service.notifyCommercialOpsOverageFlag({ tenantKey: "acme", request: makeRequest() });

    expect(result.recipientCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
