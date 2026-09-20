import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { Dynamics365Connector } from "../connectors/dynamics365/dynamics365.connector";
import { EtsyConnector } from "../connectors/etsy/etsy.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { MyntraConnector } from "../connectors/myntra/myntra.connector";
import { NykaaConnector } from "../connectors/nykaa/nykaa.connector";
import { OdooConnector } from "../connectors/odoo/odoo.connector";
import { PrestaShopConnector } from "../connectors/prestashop/prestashop.connector";
import { ShopifyApiClient } from "../connectors/shopify/shopify-api-client.service";
import { ShopifyConnector } from "../connectors/shopify/shopify.connector";
import { WooCommerceBrownfieldImportService } from "../connectors/woocommerce/woocommerce-brownfield-import.service";
import { WooCommerceBulkPublishService } from "../connectors/woocommerce/woocommerce-bulk-publish.service";
import { WooCommerceConnector } from "../connectors/woocommerce/woocommerce.connector";
import { WooCommerceReconciliationService } from "../connectors/woocommerce/woocommerce-reconciliation.service";
import { LoggingModule } from "../common/logging/logging.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ConnectorCredentialService } from "./connector-credential.service";
import { ConnectorHeartbeatService } from "./connector-heartbeat.service";
import { ConnectorHttpClient } from "./connector-http-client.service";
import { ConnectorSubmissionStorageService } from "./connector-submission-storage.service";
import { ConnectorWebhookIngestionService } from "./connector-webhook-ingestion.service";
import { ConnectorWebhookLeaseSweeperService } from "./connector-webhook-lease-sweeper.service";
import { ConnectorWebhookProcessingService } from "./connector-webhook-processing.service";
import { ConnectorWebhookRelayController } from "./connector-webhook-relay.controller";
import { ConnectorFrameworkService } from "./connector-framework.service";
import { ConnectorRegistry } from "./connector.registry";

@Module({
  imports: [PrismaModule, LoggingModule, AuditModule],
  controllers: [ConnectorWebhookRelayController],
  providers: [
    AmazonConnector,
    Dynamics365Connector,
    EtsyConnector,
    FlipkartConnector,
    MeeshoConnector,
    MyntraConnector,
    NykaaConnector,
    OdooConnector,
    PrestaShopConnector,
    ShopifyApiClient,
    ShopifyConnector,
    WooCommerceBrownfieldImportService,
    WooCommerceBulkPublishService,
    WooCommerceConnector,
    WooCommerceReconciliationService,
    ConnectorRegistry,
    ConnectorCredentialService,
    ConnectorHeartbeatService,
    ConnectorHttpClient,
    ConnectorSubmissionStorageService,
    ConnectorFrameworkService,
    ConnectorWebhookIngestionService,
    ConnectorWebhookProcessingService,
    ConnectorWebhookLeaseSweeperService,
  ],
  exports: [
    ConnectorRegistry,
    ConnectorCredentialService,
    ConnectorHttpClient,
    ConnectorFrameworkService,
    ConnectorWebhookIngestionService,
    ConnectorWebhookProcessingService,
  ],
})
export class ConnectorFrameworkModule {}
