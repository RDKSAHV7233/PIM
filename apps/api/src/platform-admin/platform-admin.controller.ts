import { BadRequestException, Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { CreatePlatformTenantDto } from "./dto/create-platform-tenant.dto";

@Controller("platform/tenants")
export class PlatformAdminController {
  constructor(private readonly tenantDirectoryService: TenantDirectoryService) {}

  @Public()
  @Post()
  @HttpCode(201)
  async createTenant(
    @Headers("x-pim-platform-admin-token") platformToken: string | undefined,
    @Body() dto: CreatePlatformTenantDto,
  ) {
    const expectedToken = String(process.env.PIM_PLATFORM_ADMIN_TOKEN ?? "").trim();
    if (!expectedToken || platformToken !== expectedToken) {
      throw new UnauthorizedException({ error: "PLATFORM_ADMIN_TOKEN_REQUIRED" });
    }

    try {
      return await this.tenantDirectoryService.provisionWorkspace({
        tenantKey: dto.tenantKey,
        workspaceSlug: dto.workspaceSlug,
        displayName: dto.displayName,
        initialAdminUserId: dto.initialAdminUserId,
      });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      throw new BadRequestException({ error: code });
    }
  }
}
