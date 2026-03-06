import { Injectable, OnModuleInit } from "@nestjs/common";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { LoggerService } from "../common/logging/logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorNotFoundError } from "./connector.errors";
import { ConnectorInterface } from "./connector.interface";

@Injectable()
export class ConnectorRegistry implements OnModuleInit {
  private readonly connectors = new Map<string, ConnectorInterface>();
  private readonly implementationMap = new Map<string, ConnectorInterface>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    amazonConnector: AmazonConnector,
    flipkartConnector: FlipkartConnector,
    meeshoConnector: MeeshoConnector,
  ) {
    this.implementationMap.set(amazonConnector.slug, amazonConnector);
    this.implementationMap.set(flipkartConnector.slug, flipkartConnector);
    this.implementationMap.set(meeshoConnector.slug, meeshoConnector);
  }

  async onModuleInit() {
    await this.refreshFromDefinitions();
  }

  private register(connector: ConnectorInterface) {
    this.connectors.set(connector.slug, connector);
  }

  private async refreshFromDefinitions(): Promise<void> {
    // Default to all local implementations if DB discovery is unavailable.
    this.connectors.clear();
    for (const connector of this.implementationMap.values()) {
      this.register(connector);
    }

    try {
      const rows = await this.prisma.tenant().$queryRawUnsafe<Array<{ slug: string }>>(
        `
        SELECT slug
        FROM connector_definitions
        WHERE is_active = TRUE
        `,
      );
      const activeSlugs = new Set(
        rows.map((row) => String(row.slug ?? "").trim().toLowerCase()).filter((slug) => slug.length > 0),
      );
      this.connectors.clear();
      for (const slug of activeSlugs) {
        const implementation = this.implementationMap.get(slug);
        if (implementation) {
          this.register(implementation);
          continue;
        }
        this.logger.warn(`Active connector definition '${slug}' has no runtime implementation; skipping.`);
      }
      if (this.connectors.size === 0) {
        for (const connector of this.implementationMap.values()) {
          this.register(connector);
        }
      }
    } catch (error: unknown) {
      this.logger.warn("Connector definition discovery failed, using local runtime connector set.");
      this.logger.info("Connector definition discovery fallback reason.", {
        reason: error instanceof Error ? error.message : String(error ?? "unknown_error"),
      });
    }
  }

  getConnector(slug: string): ConnectorInterface {
    const connector = this.connectors.get(slug);
    if (!connector) {
      throw new ConnectorNotFoundError(slug);
    }
    return connector;
  }

  listConnectors(): ConnectorInterface[] {
    return Array.from(this.connectors.values());
  }
}
