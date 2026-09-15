// Coverage for NotificationsService — zero test coverage before, despite
// implementing real per-role access control (a "reviewer" only ever sees
// approval_decision notifications, never any other event type — even
// their own) and cursor-based pagination with a genuine correctness risk:
// a wrong cursor encoding could skip or duplicate notifications across
// pages, or leak another user's notification through a crafted id.

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { encodeCursorToken } from "../common/pagination/cursor-pagination";
import type { PrismaService } from "../prisma/prisma.service";
import type { OutboundWebhooksService } from "../outbound-webhooks/outbound-webhooks.service";

function makeStubs(rows: any[] = []) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(0);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tenantClient = { userNotification: { findMany, count, updateMany } };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) } as unknown as PrismaService;
  const outboundWebhooksService = { enqueueNotificationEvent: jest.fn().mockResolvedValue(undefined) } as unknown as OutboundWebhooksService;
  return { prisma, outboundWebhooksService, findMany, count, updateMany };
}

const BASE_ROW = {
  id: "notif-1",
  eventType: "publish_succeeded",
  title: "Published",
  message: "Your product was published.",
  actionUrl: null,
  actionLabel: null,
  metadata: {},
  readAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

describe("NotificationsService — per-role visibility (no prior coverage)", () => {
  it("restricts a reviewer to only the approval_decision event type, even for their own notifications", async () => {
    const stubs = makeStubs([]);
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    await service.listForUser("user-1", "reviewer");

    expect(stubs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", eventType: { in: ["approval_decision"] } },
      }),
    );
  });

  it("does not restrict event types for a non-reviewer role — sees every notification type addressed to them", async () => {
    const stubs = makeStubs([]);
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    await service.listForUser("user-1", "editor");

    expect(stubs.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
  });

  it("markAllRead for a reviewer only touches their approval_decision notifications, not every unread row", async () => {
    const stubs = makeStubs();
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    await service.markAllRead("user-1", "reviewer");

    expect(stubs.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", eventType: { in: ["approval_decision"] }, readAt: null },
      }),
    );
  });
});

describe("NotificationsService.markRead — cross-user isolation (no prior coverage)", () => {
  it("marks the caller's own notification read", async () => {
    const stubs = makeStubs();
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    const result = await service.markRead("notif-1", "user-1");

    expect(result).toEqual({ id: "notif-1", read: true });
    expect(stubs.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "notif-1", userId: "user-1" } }),
    );
  });

  it("throws NotFoundException (not a silent no-op) when the notification doesn't belong to the caller", async () => {
    const stubs = makeStubs();
    stubs.updateMany.mockResolvedValue({ count: 0 }); // simulates: row exists for a different user, or doesn't exist
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    await expect(service.markRead("someone-elses-notification", "user-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("NotificationsService.listForUser — cursor pagination correctness (no prior coverage)", () => {
  it("omits nextCursor when the page doesn't overflow the limit", async () => {
    const stubs = makeStubs([BASE_ROW]);
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    const result = await service.listForUser("user-1", "editor", { pagination: "cursor", cursor: undefined, limit: 20 });

    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  it("returns a nextCursor when more rows exist than the page limit, and never leaks the overflow row into items", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ ...BASE_ROW, id: `notif-${i}`, createdAt: new Date(Date.now() - i * 1000) }));
    const stubs = makeStubs(rows); // limit will be 2, so 3 rows means "has next"
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    const result = await service.listForUser("user-1", "editor", { pagination: "cursor", cursor: undefined, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("decodes a valid cursor from the first page and applies it as an additional AND-ed filter on the second call", async () => {
    const stubs = makeStubs([]);
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);
    const cursor = encodeCursorToken({ sort: "0||2026-09-01T00:00:00.000Z", id: "notif-1" });

    await service.listForUser("user-1", "editor", { pagination: "cursor", cursor, limit: 20 });

    const callArgs = stubs.findMany.mock.calls[0][0];
    expect(callArgs.where).toEqual(
      expect.objectContaining({
        AND: [{ userId: "user-1" }, expect.anything()],
      }),
    );
  });

  it("rejects a garbage cursor with BadRequestException instead of silently ignoring it or crashing", async () => {
    const stubs = makeStubs([]);
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    await expect(
      service.listForUser("user-1", "editor", { pagination: "cursor", cursor: "not-a-real-cursor-token", limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stubs.findMany).not.toHaveBeenCalled();
  });

  it("a full round trip (page 1's own emitted cursor decodes and re-applies cleanly on page 2) doesn't throw", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...BASE_ROW,
      id: `notif-${i}`,
      createdAt: new Date(Date.now() - i * 1000),
    }));
    const stubs = makeStubs(rows);
    const service = new NotificationsService(stubs.prisma, stubs.outboundWebhooksService);

    const page1 = await service.listForUser("user-1", "editor", { pagination: "cursor", cursor: undefined, limit: 2 });
    expect(page1.nextCursor).not.toBeNull();

    stubs.findMany.mockResolvedValue([]); // page 2: no more rows
    const page2 = await service.listForUser("user-1", "editor", { pagination: "cursor", cursor: page1.nextCursor!, limit: 2 });
    expect(page2.items).toHaveLength(0);
    expect(page2.nextCursor).toBeNull();
  });
});
