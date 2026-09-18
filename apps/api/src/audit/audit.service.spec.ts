import { AuditService } from "./audit.service";

describe("AuditService metadata sanitization", () => {
  function createService() {
    const createMock = jest.fn().mockResolvedValue({});
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        auditLog: { create: createMock },
      }),
    };
    const service = new AuditService(prisma as never);
    return { service, createMock };
  }

  it("redacts sensitive value strings even when key name is non-sensitive", async () => {
    const { service, createMock } = createService();

    await service.record({
      actorId: "user_1",
      actorRole: "admin",
      action: "CREATE",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: "inst_1",
      metadata: {
        message: "temporary token value from upstream",
        connectorSlug: "amazon-in",
      },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const metadata = createMock.mock.calls[0][0].data.metadata as Record<string, string>;
    // "message" value contains "token" — should be redacted
    expect(metadata.message).toBe("[REDACTED]");
    // "connectorSlug" value is non-sensitive — should pass through
    expect(metadata.connectorSlug).toBe("amazon-in");
  });

  it("redacts keys that match sensitive patterns regardless of value", async () => {
    const { service, createMock } = createService();

    await service.record({
      actorId: "user_1",
      actorRole: "admin",
      action: "UPDATE",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: "inst_2",
      metadata: {
        apiKey: "abc123",
        refreshToken: "tok_xyz",
        displayName: "My Connector",
      },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const metadata = createMock.mock.calls[0][0].data.metadata as Record<string, string>;
    // "apiKey" ends with "key" — redacted regardless of value
    expect(metadata.apiKey).toBe("[REDACTED]");
    // "refreshToken" contains "token" — redacted
    expect(metadata.refreshToken).toBe("[REDACTED]");
    // "displayName" is non-sensitive — passes through
    expect(metadata.displayName).toBe("My Connector");
  });

  it("does not throw when audit log write fails — primary path must continue", async () => {
    const createMock = jest.fn().mockRejectedValue(new Error("DB unavailable"));
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        auditLog: { create: createMock },
      }),
    };
    const service = new AuditService(prisma as never);

    // Should not throw even though the DB call rejects
    await expect(
      service.record({
        actorId: "user_1",
        actorRole: "admin",
        action: "CREATE",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: "inst_1",
      }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// queryEventsForExport / renderEventsCsv — silent-truncation fix
// ---------------------------------------------------------------------------
//
// The export endpoint (/audit/events/export) hard-caps at 5000 rows with no
// cursor. Before this fix, an installation/tenant with more than 5000
// matching events would silently get an incomplete CSV with zero indication
// anything was cut off — an admin exporting audit logs for a security
// incident could believe the export is complete when it isn't. Fixed by
// fetching CAP+1 rows to detect truncation precisely (not just "length ===
// CAP", which would false-positive on exactly-CAP-many real rows), and by
// appending a visible marker row to the CSV itself — this endpoint is
// downloaded via a plain browser link and opened directly in a spreadsheet
// tool, so a response header would never actually be seen by anyone.

function makeAuditLogRow(overrides: Partial<{
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}> = {}) {
  return {
    id: "evt_1",
    actorId: "user_1",
    actorRole: "admin",
    action: "UPDATE",
    resource: "PRODUCT",
    resourceId: "prod_1",
    metadata: {},
    createdAt: new Date("2026-09-17T00:00:00.000Z"),
    ...overrides,
  };
}

function makeExportService(rows: ReturnType<typeof makeAuditLogRow>[]) {
  const findManyMock = jest.fn().mockResolvedValue(rows);
  const prisma = {
    tenant: jest.fn().mockReturnValue({
      auditLog: { findMany: findManyMock },
    }),
  };
  const service = new AuditService(prisma as never);
  return { service, findManyMock };
}

describe("AuditService.queryEventsForExport", () => {
  it("returns truncated: false and all rows when the count is under the cap", async () => {
    const rows = [makeAuditLogRow({ id: "evt_1" }), makeAuditLogRow({ id: "evt_2" })];
    const { service } = makeExportService(rows);

    const result = await service.queryEventsForExport({} as never);

    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(2);
  });

  it("fetches CAP+1 rows so truncation can be detected precisely", async () => {
    const { service, findManyMock } = makeExportService([makeAuditLogRow()]);

    await service.queryEventsForExport({} as never);

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 5001 }));
  });

  it("reports truncated: true and caps items at exactly 5000 when more than 5000 rows match", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => makeAuditLogRow({ id: `evt_${i}` }));
    const { service } = makeExportService(rows);

    const result = await service.queryEventsForExport({} as never);

    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(5000);
  });

  it("does not false-positive truncation when the count is exactly the cap", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => makeAuditLogRow({ id: `evt_${i}` }));
    const { service } = makeExportService(rows);

    const result = await service.queryEventsForExport({} as never);

    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(5000);
  });
});

describe("AuditService.renderEventsCsv — truncation marker", () => {
  function makeService() {
    return new AuditService({ tenant: jest.fn() } as never);
  }

  it("does not append a marker row when truncated is not passed", () => {
    const service = makeService();
    const csv = service.renderEventsCsv([]);
    expect(csv).not.toMatch(/EXPORT_TRUNCATED/);
  });

  it("does not append a marker row when truncated: false", () => {
    const service = makeService();
    const csv = service.renderEventsCsv([], { truncated: false });
    expect(csv).not.toMatch(/EXPORT_TRUNCATED/);
  });

  it("appends a visible, same-shape marker row as the last line when truncated: true", () => {
    const service = makeService();
    const csv = service.renderEventsCsv(
      [
        {
          id: "evt_1",
          actorId: "user_1",
          actorRole: "admin",
          action: "UPDATE",
          resource: "PRODUCT",
          resourceId: "prod_1",
          metadata: {},
          createdAt: new Date("2026-09-17T00:00:00.000Z"),
        },
      ],
      { truncated: true },
    );

    const lines = csv.split("\n");
    expect(lines[lines.length - 1]).toMatch(/EXPORT_TRUNCATED/);
    expect(lines[lines.length - 1]).toMatch(/capped at 5000 rows/);
    // Same 8-column shape as every real data row — a spreadsheet tool won't
    // misrender it as a ragged row.
    expect(lines[0].split(",").length).toBe(lines[lines.length - 1].split(",").length);
  });
});
