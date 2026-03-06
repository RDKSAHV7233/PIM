import { Module } from "@nestjs/common";
import { ConnectorFrameworkModule } from "../connector-framework/connector-framework.module";
import { MetricsModule } from "../metrics/metrics.module";
import { QueueModule } from "../queue/queue.module";
import { ConnectorMappingService } from "./connector-mapping.service";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";
import { SubmissionsController } from "./submissions.controller";

@Module({
  imports: [QueueModule, ConnectorFrameworkModule, MetricsModule],
  controllers: [MarketplaceController, SubmissionsController],
  providers: [MarketplaceService, ConnectorMappingService],
  exports: [MarketplaceService, ConnectorMappingService],
})
export class MarketplaceModule {}
