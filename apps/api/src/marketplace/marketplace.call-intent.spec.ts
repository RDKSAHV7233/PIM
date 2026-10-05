// marketplace.call-intent.spec.ts
//
// Sprint 3, PR 3c. A provider write is preceded by a durable PENDING submission carrying
// PROVIDER_CALL_IN_FLIGHT, and a write whose response is lost is recorded as an OUTCOME UNKNOWN,
// not as a plain failure. This drives MarketplaceService.recordConnectorSubmission with the REAL
// ConnectorFrameworkService.recordSubmissionAttempt over an in-memory submissions table, so the
// persisted states below are what the real recording code produces.

import { ConnectorFrameworkService } from "../connector-framework/connector-framework.service";
import {
  ConnectorNetworkError,
  CredentialExpiredError,
} from "../connector-framework/connector.errors";
import type { ConnectorInstallationRecord } from "../connector-framework/connector.types";
import { MarketplaceService } from "./marketplace.service";

interface Row {
  id: string;
  status: string;
  attemptNumber: number;
  resolvedAt: Date | null;
  externalRef: string | null;
  channelErrors: Array<{ code?: string; severity?: string }>;
}

function makeRig(options: { failIntentWrite?: boolean; capabilities?: string[] } = {}) {
  const rows = new Map<string, Row>();
  const history: Array<{ status: string; code: string | null }> = [];
  let intentWrites = 0;

  const upsert = jest.fn(async (args: { where: { tenantKey_installationId_idempotencyKey: { idempotencyKey: string } }; create: Record<string, any>; update: Record<string, any> }) => {
    const key = args.where.tenantKey_installationId_idempotencyKey.idempotencyKey;
    const isIntent = args.create.status === "PENDING" && (args.create.channelErrors as any[])?.[0]?.code === "PROVIDER_CALL_IN_FLIGHT";
    if (isIntent && options.failIntentWrite && intentWrites++ === 0) throw new Error("database unavailable");
    const existing = rows.get(key);
    let row: Row;
    if (!existing) {
      row = {
        id: `sub-${rows.size + 1}`,
        status: args.create.status,
        attemptNumber: args.create.attemptNumber,
        resolvedAt: args.create.resolvedAt ?? null,
        externalRef: args.create.externalRef ?? null,
        channelErrors: args.create.channelErrors ?? [],
      };
    } else {
      row = { ...existing };
      const u = args.update;
      if (u.attemptNumber?.increment) row.attemptNumber += u.attemptNumber.increment;
      row.status = u.status;
      if (u.externalRef) row.externalRef = u.externalRef;
      row.channelErrors = u.channelErrors;
      if ("resolvedAt" in u) row.resolvedAt = u.resolvedAt;
    }
    rows.set(key, row);
    history.push({ status: row.status, code: row.channelErrors[0]?.code ?? null });
    return {
      id: row.id,
      idempotencyKey: key,
      attemptNumber: row.attemptNumber,
      status: row.status,
      submissionType: "PUBLISH",
      source: "LIVE_API",
      payloadSnapshotUrl: null,
    };
  });

  const framework = new ConnectorFrameworkService(
    { tenant: () => ({ connectorSubmission: { upsert } }) } as never,
    {} as never,
    { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as never,
    {} as never,
    {} as never,
    { storeSnapshot: jest.fn() } as never,
  );

  const installation = {
    id: "inst-1",
    tenantKey: "tenant1",
    slug: "odoo",
    capabilities: options.capabilities ?? ["PUBLISH"],
  } as unknown as ConnectorInstallationRecord;
  jest.spyOn(framework, "getCurrentTenantKey").mockReturnValue("tenant1");
  jest.spyOn(framework, "requireInstallation").mockResolvedValue(installation);
  const publish = jest.spyOn(framework, "publish");

  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const svc = new MarketplaceService(
    {} as never,
    framework as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never,
    {} as never,
    { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
    {} as never,
  );
  jest.spyOn(svc as any, "mapChannelToConnectorSlug").mockReturnValue("odoo");
  jest.spyOn(svc as any, "buildConnectorProductPayload").mockResolvedValue({ sku: "SKU-1", title: "A product" });
  jest.spyOn(svc as any, "emitConnectorOutcomeMetrics").mockResolvedValue(undefined);

  const job = { id: "job-1", productId: "prod-1", channel: "ODOO", installationId: "inst-1", categoryId: null };
  const simulation = {
    exportReady: true,
    mappedPayload: { sku: "SKU-1" },
    channelIssues: [],
    validationSource: "local_rules" as const,
  };
  const run = () => (svc as any).recordConnectorSubmission(job, simulation) as Promise<{ kind: string; submissionId: string }>;
  const row = () => [...rows.values()][0];
  return { rows, row, history, publish, run, upsert };
}

function transportError(code: string): TypeError {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
}

describe("recordConnectorSubmission — call intent", () => {
  it("records the PENDING intent BEFORE the provider is called, then the result, as ONE attempt", async () => {
    const rig = makeRig();
    let stateWhenProviderWasCalled: { status: string; code: string | null } | null = null;
    rig.publish.mockImplementation(async () => {
      stateWhenProviderWasCalled = { status: rig.row().status, code: rig.row().channelErrors[0]?.code ?? null };
      return { externalRef: "77", status: "SUCCESS", isAsync: false };
    });

    const outcome = await rig.run();

    expect(stateWhenProviderWasCalled).toEqual({ status: "PENDING", code: "PROVIDER_CALL_IN_FLIGHT" });
    expect(outcome.kind).toBe("success");
    expect(rig.row()).toMatchObject({ status: "SUCCESS", attemptNumber: 1, externalRef: "77" });
    expect(rig.row().resolvedAt).toBeInstanceOf(Date);
    expect(rig.row().channelErrors.some((e) => e.code === "PROVIDER_CALL_IN_FLIGHT")).toBe(false); // the marker does not outlive the call
    expect(rig.history.map((h) => h.status)).toEqual(["PENDING", "SUCCESS"]);
  });

  describe("a write whose response is lost is an unknown outcome, not a failure", () => {
    it.each([
      ["a connection reset", () => transportError("ECONNRESET")],
      ["a timeout", () => Object.assign(new Error("The operation timed out"), { name: "TimeoutError" })],
      ["a network error after the request may have been sent", () => new ConnectorNetworkError("bigcommerce", "NETWORK", true, "connection failed (ECONNRESET)")],
      ["a connector that declares its write may have executed", () => Object.assign(new Error("Odoo product publish failed: the create outcome is unknown."), { name: "OdooPublishError", outcomeUnknown: true })],
    ])("%s", async (_label, makeError) => {
      const rig = makeRig();
      const error = makeError();
      rig.publish.mockRejectedValue(error);

      await expect(rig.run()).rejects.toBe(error); // the job still sees the failure and decides retry/dead-letter

      expect(rig.row().status).toBe("PENDING");
      expect(rig.row().resolvedAt).toBeNull();
      expect(rig.row().channelErrors[0]).toMatchObject({ code: "PROVIDER_OUTCOME_UNKNOWN", severity: "warning" });
      expect(rig.row().attemptNumber).toBe(1);
      expect(rig.history.map((h) => h.status)).toEqual(["PENDING", "PENDING"]);
    });
  });

  describe("a failure where the provider answered, or never received the request, stays a final ERROR", () => {
    it.each([
      ["a provider-reported error", () => new Error("BigCommerce request failed with status 422: invalid category")],
      ["a DNS failure (never sent)", () => transportError("ENOTFOUND")],
      ["a refused connection (never sent)", () => transportError("ECONNREFUSED")],
      ["a DNS-category network error", () => new ConnectorNetworkError("woocommerce", "DNS", false, "DNS resolution failed (ENOTFOUND)")],
      ["expired credentials", () => new CredentialExpiredError("odoo")],
    ])("%s", async (_label, makeError) => {
      const rig = makeRig();
      const error = makeError();
      rig.publish.mockRejectedValue(error);

      await expect(rig.run()).rejects.toBe(error);

      expect(rig.row().status).toBe("ERROR");
      expect(rig.row().resolvedAt).toBeInstanceOf(Date);
      expect(rig.row().channelErrors.some((e) => e.code === "PROVIDER_OUTCOME_UNKNOWN")).toBe(false);
      expect(rig.row().attemptNumber).toBe(1);
    });
  });

  it("a replay after an unknown outcome settles the same row as one more attempt", async () => {
    const rig = makeRig();
    rig.publish.mockRejectedValueOnce(transportError("ECONNRESET"));
    await expect(rig.run()).rejects.toBeDefined();
    expect(rig.row()).toMatchObject({ status: "PENDING", attemptNumber: 1 });

    rig.publish.mockResolvedValueOnce({ externalRef: "77", status: "SUCCESS", isAsync: false });
    await rig.run();

    expect(rig.rows.size).toBe(1);
    expect(rig.row()).toMatchObject({ status: "SUCCESS", attemptNumber: 2, externalRef: "77" });
    expect(rig.row().resolvedAt).toBeInstanceOf(Date);
    expect(rig.row().channelErrors.some((e) => e.code?.startsWith("PROVIDER_"))).toBe(false);
  });

  it("a replay of an earlier ERROR is not left looking resolved while it is in flight", async () => {
    const rig = makeRig();
    rig.publish.mockRejectedValueOnce(new Error("provider said no"));
    await expect(rig.run()).rejects.toBeDefined();
    expect(rig.row().resolvedAt).toBeInstanceOf(Date);

    let resolvedAtDuringReplay: Date | null | undefined;
    rig.publish.mockImplementationOnce(async () => {
      resolvedAtDuringReplay = rig.row().resolvedAt;
      return { externalRef: "9", status: "SUCCESS", isAsync: false };
    });
    await rig.run();

    expect(resolvedAtDuringReplay).toBeNull();
    expect(rig.row().attemptNumber).toBe(2);
  });

  it("if the intent cannot be recorded, the provider is never called", async () => {
    const rig = makeRig({ failIntentWrite: true });
    rig.publish.mockResolvedValue({ externalRef: "77", status: "SUCCESS", isAsync: false });

    await expect(rig.run()).rejects.toMatchObject({ name: "SubmissionIntentNotRecordedError" });

    expect(rig.publish).not.toHaveBeenCalled();
    expect(rig.row().status).toBe("ERROR"); // recorded as a failure that never reached the provider
    expect(rig.row().channelErrors.some((e) => e.code === "PROVIDER_OUTCOME_UNKNOWN")).toBe(false);
  });

  it("an async PENDING answer from the provider is still accepted_async and not mistaken for the intent", async () => {
    const rig = makeRig();
    rig.publish.mockResolvedValue({ externalRef: "feed-1", status: "PENDING", isAsync: true });

    const outcome = await rig.run();

    expect(outcome.kind).toBe("accepted_async");
    expect(rig.row()).toMatchObject({ status: "PENDING", externalRef: "feed-1", attemptNumber: 1 });
    expect(rig.row().channelErrors.some((e) => e.code === "PROVIDER_CALL_IN_FLIGHT")).toBe(false);
  });

  it("an export-only connector (no provider write) records no intent", async () => {
    const rig = makeRig({ capabilities: ["EXCEL_EXPORT"] });

    await rig.run();

    expect(rig.publish).not.toHaveBeenCalled();
    expect(rig.history.map((h) => h.code)).not.toContain("PROVIDER_CALL_IN_FLIGHT");
    expect(rig.row().attemptNumber).toBe(1);
  });
});
