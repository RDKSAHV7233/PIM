import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantDirectoryModule } from "../common/tenant/tenant-directory.module";
import { AuthController } from "./auth.controller";
import { AuthEmailService } from "./auth-email.service";
import { AuthExportStorageService } from "./auth-export-storage.service";
import { AuthService } from "./auth.service";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { StepUpGuard } from "./step-up.guard";

@Module({
  imports: [AuditModule, TenantDirectoryModule],
  controllers: [AuthController],
  providers: [AuthService, AuthEmailService, AuthExportStorageService, JwtBlocklistService, StepUpGuard],
  exports: [AuthService, AuthEmailService, AuthExportStorageService, JwtBlocklistService, StepUpGuard],
})
export class AuthModule {}
