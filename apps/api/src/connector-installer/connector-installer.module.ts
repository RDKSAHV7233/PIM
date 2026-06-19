import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { ConnectorFrameworkModule } from "../connector-framework/connector-framework.module";
import { LoggingModule } from "../common/logging/logging.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { ConnectorInstallerController } from "./connector-installer.controller";
import { ConnectorPermissionService } from "./connector-permission.service";
import { ConnectorCredentialEncryptionService } from "./credential-encryption.service";
import { ConnectorInstallerService } from "./connector-installer.service";

@Module({
  imports: [ConnectorFrameworkModule, AuditModule, LoggingModule, MarketplaceModule, AccessPolicyModule, DashboardModule],
  controllers: [ConnectorInstallerController],
  providers: [ConnectorInstallerService, ConnectorCredentialEncryptionService, ConnectorPermissionService],
  exports: [ConnectorInstallerService, ConnectorCredentialEncryptionService],
})
export class ConnectorInstallerModule {}
