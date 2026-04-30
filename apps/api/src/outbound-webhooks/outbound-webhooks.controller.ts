import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute, ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { Roles, type AppRole } from "../common/rbac/roles";
import { CreateOutboundWebhookDto } from "./dto/create-outbound-webhook.dto";
import { ListOutboundWebhookDeliveriesDto } from "./dto/list-outbound-webhook-deliveries.dto";
import { UpdateOutboundWebhookDto } from "./dto/update-outbound-webhook.dto";
import { OutboundWebhooksService } from "./outbound-webhooks.service";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimTenant?: string;
  pimRole?: AppRole;
  pimJwtClaims?: {
    sub?: string;
    tenantId?: string;
    role?: AppRole;
  };
};

@Controller("admin/webhooks")
@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@AdminBoundaryAccess({ capability: "manage_security" })
@Roles("admin")
export class OutboundWebhooksController {
  constructor(private readonly outboundWebhooksService: OutboundWebhooksService) {}

  @Get()
  @ReadAccessPolicy("outbound_webhooks_governance_redacted")
  listEndpoints(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.listEndpoints(actor.tenantId);
  }

  @Get("deliveries")
  @ReadAccessPolicy("outbound_webhook_deliveries_governance_redacted")
  listDeliveries(@Req() request: AuthenticatedRequest, @Query() query: ListOutboundWebhookDeliveriesDto) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.listDeliveries(actor.tenantId, query);
  }

  @Post()
  createEndpoint(@Req() request: AuthenticatedRequest, @Body() dto: CreateOutboundWebhookDto) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.createEndpoint(actor.tenantId, actor.userId, actor.role, dto);
  }

  @Patch(":id")
  @HttpCode(200)
  updateEndpoint(
    @Req() request: AuthenticatedRequest,
    @Param("id") endpointId: string,
    @Body() dto: UpdateOutboundWebhookDto,
  ) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.updateEndpoint(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(endpointId),
      dto,
    );
  }

  @Post(":id/test")
  @HttpCode(200)
  sendTestDelivery(@Req() request: AuthenticatedRequest, @Param("id") endpointId: string) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.sendTestDelivery(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(endpointId),
    );
  }

  @Delete(":id")
  @HttpCode(200)
  deleteEndpoint(@Req() request: AuthenticatedRequest, @Param("id") endpointId: string) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.deleteEndpoint(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(endpointId),
    );
  }

  private requireActor(request: AuthenticatedRequest): { userId: string; tenantId: string; role: AppRole } {
    const userId = request.pimUserId ?? request.pimJwtClaims?.sub;
    const tenantId = request.pimTenant ?? request.pimJwtClaims?.tenantId;
    const role = request.pimRole ?? request.pimJwtClaims?.role;
    if (!userId || !tenantId || !role) {
      throw new UnauthorizedException("Bearer token is required.");
    }
    return { userId, tenantId, role };
  }
}
