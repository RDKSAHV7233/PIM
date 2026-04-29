import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PolicyActor } from "../common/access-policy/access-policy.service";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
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
  pimEffectiveRoles?: string[];
};

@DisallowApiClient()
@Controller("compliance")
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get("rules")
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  listRules(@Query("categoryId") categoryId?: string) {
    return this.complianceService.listRules(categoryId);
  }

  @Post("rules")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  createRule(@Body() dto: CreateComplianceRuleDto) {
    return this.complianceService.createRule(dto);
  }

  @Patch("rules/:id")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  updateRule(@Param("id") id: string, @Body() dto: UpdateComplianceRuleDto) {
    return this.complianceService.updateRule(id, dto);
  }

  @Delete("rules/:id")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  deleteRule(@Param("id") id: string) {
    return this.complianceService.deleteRule(id);
  }

  @Post("products/:id/validate")
  validateProduct(@Param("id") productId: string, @Req() request: AuthenticatedRequest) {
    return this.complianceService.validateAndPersistProduct(productId, this.resolveActor(request));
  }

  @Get("products/:id/issues")
  @FoundationRoleAccess("vendor")
  @AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("compliance.read")
  getProductIssues(@Param("id") productId: string, @Req() request: AuthenticatedRequest) {
    return this.complianceService.getProductIssues(productId, this.resolveActor(request));
  }

  private resolveActor(request: AuthenticatedRequest): PolicyActor {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
      effectiveRoles: request.pimEffectiveRoles,
    };
  }
}
