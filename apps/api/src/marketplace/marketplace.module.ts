import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { AuthModule } from "../auth/auth.module";
import { ConnectorFrameworkModule } from "../connector-framework/connector-framework.module";
import { MediaModule } from "../media/media.module";
import { MetricsModule } from "../metrics/metrics.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { QueueModule } from "../queue/queue.module";
import { ConnectorMappingService } from "./connector-mapping.service";
import { ExportJobReconciliationService } from "./export-job-reconciliation.service";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { PriceResolutionService } from "./price-resolution.service";
import { SubmissionsController } from "./submissions.controller";

@Module({
  imports: [QueueModule, ConnectorFrameworkModule, MetricsModule, AuthModule, AuditModule, NotificationsModule, AccessPolicyModule, MediaModule],
  controllers: [MarketplaceController, SubmissionsController],
  providers: [MarketplaceService, ConnectorMappingService, PriceResolutionService, ExportJobReconciliationService],
  exports: [MarketplaceService, ConnectorMappingService, PriceResolutionService],
})
export class MarketplaceModule {}
