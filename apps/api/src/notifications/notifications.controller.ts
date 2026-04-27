import { Controller, Get, Patch, Param, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import type { AppRole } from "../common/rbac/roles";
import { NotificationsService } from "./notifications.service";

type NotificationRequest = FastifyRequest & {
  pimUserId?: string;
  pimRole?: AppRole;
};

@DisallowApiClient()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ReadAccessPolicy("notification_self_service")
  listNotifications(@Req() request: NotificationRequest, @Query() pagination?: CursorPaginationDto) {
    const actor = this.requireActor(request);
    return this.notificationsService.listForUser(actor.userId, actor.role, pagination);
  }

  @Patch("read-all")
  markAllRead(@Req() request: NotificationRequest) {
    const actor = this.requireActor(request);
    return this.notificationsService.markAllRead(actor.userId, actor.role);
  }

  @Patch(":id/read")
  markRead(@Param("id") notificationId: string, @Req() request: NotificationRequest) {
    const actor = this.requireActor(request);
    return this.notificationsService.markRead(notificationId, actor.userId);
  }

  private requireActor(request: NotificationRequest): { userId: string; role: AppRole } {
    const userId = typeof request.pimUserId === "string" ? request.pimUserId.trim() : "";
    const role = request.pimRole ?? "viewer";
    if (!userId) {
      throw new UnauthorizedException("Missing authenticated actor context.");
    }
    return { userId, role };
  }
}
