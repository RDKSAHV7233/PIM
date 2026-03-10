import { Module } from "@nestjs/common";
import { TenantDirectoryModule } from "../common/tenant/tenant-directory.module";
import { PlatformAdminController } from "./platform-admin.controller";

@Module({
  imports: [TenantDirectoryModule],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
