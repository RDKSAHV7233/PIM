import { BadRequestException, Body, Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { Request } from "express";
import { AuditService } from "../audit/audit.service";
import { Public } from "../auth/public.decorator";
import { requireInternalToken } from "../common/security/internal-token";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { CreatePlatformTenantDto } from "./dto/create-platform-tenant.dto";

@Controller("platform/tenants")
export class PlatformAdminController {
  private readonly logger = new Logger(PlatformAdminController.name);

  constructor(
    private readonly tenantDirectoryService: TenantDirectoryService,
    private readonly auditService: AuditService,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  async createTenant(
    @Headers("x-pim-platform-admin-token") platformToken: string | undefined,
    @Body() dto: CreatePlatformTenantDto,
    @Req() request: Request,
  ) {
    const expectedToken = String(process.env.PIM_PLATFORM_ADMIN_TOKEN ?? "").trim();
    try {
      await requireInternalToken({
        routeKey: "platform.tenants.create",
        expectedToken,
        submittedToken: platformToken,
        request,
        onFailure: (event) =>
          this.auditService.record({
            actorId: "internal-token",
            actorRole: "system",
            action: "PLATFORM_ADMIN_TOKEN_REJECTED",
            resource: "PLATFORM_TENANT_PROVISIONING",
            resourceId: String(dto?.tenantKey ?? "unknown"),
            metadata: {
              event: "platform_admin_token_rejected",
              routeKey: event.routeKey,
              reason: event.reason,
              remoteAddress: event.remoteAddress,
              retryAfterSeconds: event.retryAfterSeconds ?? null,
            },
          }),
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException({ error: "PLATFORM_ADMIN_TOKEN_REQUIRED" });
      }
      throw error;
    }

    try {
      const initialAdminPasswordHash = await bcrypt.hash(String(dto.initialAdminPassword), 12);
      const result = await this.tenantDirectoryService.provisionWorkspaceWithPasswordHash({
        tenantKey: dto.tenantKey,
        workspaceSlug: dto.workspaceSlug,
        displayName: dto.displayName,
        initialAdminUserId: dto.initialAdminUserId,
        initialAdminPasswordHash,
      });
      await this.auditService.record({
        actorId: "platform-admin-token",
        actorRole: "system",
        action: "PLATFORM_TENANT_PROVISIONED",
        resource: "PLATFORM_TENANT_PROVISIONING",
        resourceId: dto.tenantKey,
        tenantKey: dto.tenantKey,
        metadata: {
          event: "platform_tenant_provisioned",
          workspaceSlug: dto.workspaceSlug,
          initialAdminUserId: dto.initialAdminUserId,
        },
      });
      return result;
    } catch (error: unknown) {
      // Log full error server-side; return a generic code so internal DB / provisioning details are not leaked.
      this.logger.error(`createTenant failed for tenant ${dto.tenantKey}`, error instanceof Error ? error.stack : String(error));
      throw new BadRequestException({ error: "TENANT_PROVISIONING_FAILED" });
    }
  }
}
