import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { RejectionIntelligenceService } from "./rejection-intelligence.service";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "human_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("rejection-intelligence")
export class RejectionIntelligenceController {
  constructor(private readonly rejectionIntelligenceService: RejectionIntelligenceService) {}

  private resolveActor(request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    };
  }

  @Get("products/:id/score")
  @Roles("admin", "editor", "reviewer")
  scoreProduct(
    @Param("id") productId: string,
    @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.rejectionIntelligenceService.scoreProduct(productId, channel, this.resolveActor(request));
  }
}
