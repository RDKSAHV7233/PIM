import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { ShopifyConnector } from "../connectors/shopify/shopify.connector";
import { LoggingModule } from "../common/logging/logging.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ConnectorWebhookIngestionService } from "./connector-webhook-ingestion.service";
import { ConnectorWebhookProcessingService } from "./connector-webhook-processing.service";
import { ConnectorWebhookRelayController } from "./connector-webhook-relay.controller";
import { ConnectorFrameworkService } from "./connector-framework.service";
import { ConnectorRegistry } from "./connector.registry";

@Module({
  imports: [PrismaModule, LoggingModule, AuditModule],
  controllers: [ConnectorWebhookRelayController],
  providers: [
    AmazonConnector,
    FlipkartConnector,
    MeeshoConnector,
    ShopifyConnector,
    ConnectorRegistry,
    ConnectorFrameworkService,
    ConnectorWebhookIngestionService,
    ConnectorWebhookProcessingService,
  ],
  exports: [
    ConnectorRegistry,
    ConnectorFrameworkService,
    ConnectorWebhookIngestionService,
    ConnectorWebhookProcessingService,
  ],
})
export class ConnectorFrameworkModule {}
