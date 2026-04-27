import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PolicyActor } from "../common/access-policy/access-policy.service";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { ComplianceService } from "./compliance.service";
import { CreateComplianceRuleDto } from "./dto/create-compliance-rule.dto";
import { UpdateComplianceRuleDto } from "./dto/update-compliance-rule.dto";

type AuthenticatedRequest = FastifyRequest & {
  pimUserId?: string;
  pimRole?: AppRole;
  pimTenant?: string;
  pimAuthType?: "user_jwt" | "api_key";
};

@DisallowApiClient()
@Controller("compliance")
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get("rules")
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @Roles("admin")
  listRules(@Query("categoryId") categoryId?: string) {
    return this.complianceService.listRules(categoryId);
  }

  @Post("rules")
  @Roles("admin")
  createRule(@Body() dto: CreateComplianceRuleDto) {
    return this.complianceService.createRule(dto);
  }

  @Patch("rules/:id")
  @Roles("admin")
  updateRule(@Param("id") id: string, @Body() dto: UpdateComplianceRuleDto) {
    return this.complianceService.updateRule(id, dto);
  }

  @Delete("rules/:id")
  @Roles("admin")
  deleteRule(@Param("id") id: string) {
    return this.complianceService.deleteRule(id);
  }

  @Post("products/:id/validate")
  validateProduct(@Param("id") productId: string, @Req() request: AuthenticatedRequest) {
    return this.complianceService.validateAndPersistProduct(productId, this.resolveActor(request));
  }

  @Get("products/:id/issues")
  @AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  getProductIssues(@Param("id") productId: string, @Req() request: AuthenticatedRequest) {
    return this.complianceService.getProductIssues(productId, this.resolveActor(request));
  }

  private resolveActor(request: AuthenticatedRequest): PolicyActor {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
    };
  }
}
