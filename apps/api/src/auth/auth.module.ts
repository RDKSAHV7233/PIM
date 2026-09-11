import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { TenantDirectoryModule } from "../common/tenant/tenant-directory.module";
import { MetricsModule } from "../metrics/metrics.module";
import { QueueModule } from "../queue/queue.module";
import { AccountDeletionWorkerService } from "./account-deletion-worker.service";
import { AuthPolicyController } from "./auth-policy.controller";
import { AuthPolicyService } from "./auth-policy.service";
import { AuthController } from "./auth.controller";
import { AuthEmailService } from "./auth-email.service";
import { AuthExportStorageService } from "./auth-export-storage.service";
import { AuthService } from "./auth.service";
import { JwtBlocklistModule } from "./jwt-blocklist.module";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { OidcAuthService } from "./oidc-auth.service";
import { OidcConfigService } from "./oidc-config.service";
import { OidcController } from "./oidc.controller";
import { OidcService } from "./oidc.service";
import { StepUpGuard } from "./step-up.guard";

@Module({
  imports: [AuditModule, TenantDirectoryModule, MetricsModule, QueueModule, JwtBlocklistModule],
  controllers: [AuthController, AuthPolicyController, MfaController, OidcController],
  providers: [
    AuthService,
    AuthPolicyService,
    AuthEmailService,
    AuthExportStorageService,
    MfaService,
    OidcAuthService,
    OidcConfigService,
    OidcService,
    StepUpGuard,
    AccountDeletionWorkerService,
  ],
  exports: [
    AuthService,
    AuthPolicyService,
    AuthEmailService,
    AuthExportStorageService,
    MfaService,
    OidcAuthService,
    OidcConfigService,
    OidcService,
    StepUpGuard,
    AccountDeletionWorkerService,
    JwtBlocklistModule,
  ],
})
export class AuthModule {}
