import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantDirectoryModule } from "../common/tenant/tenant-directory.module";
import { AuthPolicyController } from "./auth-policy.controller";
import { AuthPolicyService } from "./auth-policy.service";
import { AuthController } from "./auth.controller";
import { AuthEmailService } from "./auth-email.service";
import { AuthExportStorageService } from "./auth-export-storage.service";
import { AuthService } from "./auth.service";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { StepUpGuard } from "./step-up.guard";

@Module({
  imports: [AuditModule, TenantDirectoryModule],
  controllers: [AuthController, AuthPolicyController, MfaController],
  providers: [
    AuthService,
    AuthPolicyService,
    AuthEmailService,
    AuthExportStorageService,
    JwtBlocklistService,
    MfaService,
    StepUpGuard,
  ],
  exports: [
    AuthService,
    AuthPolicyService,
    AuthEmailService,
    AuthExportStorageService,
    JwtBlocklistService,
    MfaService,
    StepUpGuard,
  ],
})
export class AuthModule {}
