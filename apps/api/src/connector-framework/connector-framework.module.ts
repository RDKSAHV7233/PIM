import { Module } from "@nestjs/common";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { LoggingModule } from "../common/logging/logging.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ConnectorFrameworkService } from "./connector-framework.service";
import { ConnectorRegistry } from "./connector.registry";

@Module({
  imports: [PrismaModule, LoggingModule],
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
