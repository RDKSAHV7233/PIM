import { Module } from "@nestjs/common";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { ConnectorFrameworkService } from "./connector-framework.service";
import { ConnectorRegistry } from "./connector.registry";

@Module({
  providers: [
    AmazonConnector,
    FlipkartConnector,
    MeeshoConnector,
    ConnectorRegistry,
    ConnectorFrameworkService,
  ],
  exports: [ConnectorRegistry, ConnectorFrameworkService],
})
export class ConnectorFrameworkModule {}
