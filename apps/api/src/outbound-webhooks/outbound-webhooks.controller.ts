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
import type { FastifyRequest } from "fastify";
import { Roles, type AppRole } from "../common/rbac/roles";
import { CreateOutboundWebhookDto } from "./dto/create-outbound-webhook.dto";
import { ListOutboundWebhookDeliveriesDto } from "./dto/list-outbound-webhook-deliveries.dto";
import { UpdateOutboundWebhookDto } from "./dto/update-outbound-webhook.dto";
import { OutboundWebhooksService } from "./outbound-webhooks.service";

type AuthenticatedRequest = FastifyRequest & {
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
@Roles("admin")
export class OutboundWebhooksController {
  constructor(private readonly outboundWebhooksService: OutboundWebhooksService) {}

  @Get()
  listEndpoints(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.outboundWebhooksService.listEndpoints(actor.tenantId);
  }

  @Get("deliveries")
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
