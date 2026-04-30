import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantDirectoryModule } from "../common/tenant/tenant-directory.module";
import { PlatformAdminController } from "./platform-admin.controller";

@Module({
  imports: [TenantDirectoryModule, AuditModule],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
