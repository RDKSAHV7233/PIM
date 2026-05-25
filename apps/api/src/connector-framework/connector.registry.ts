import { Injectable, OnModuleInit } from "@nestjs/common";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { ShopifyConnector } from "../connectors/shopify/shopify.connector";
import { LoggerService } from "../common/logging/logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { resolveSafeConnectorFallbackSlugs } from "./connector-launch-policy";
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
    shopifyConnector: ShopifyConnector,
  ) {
    this.implementationMap.set(amazonConnector.slug, amazonConnector);
    this.implementationMap.set(flipkartConnector.slug, flipkartConnector);
    this.implementationMap.set(meeshoConnector.slug, meeshoConnector);
    this.implementationMap.set(shopifyConnector.slug, shopifyConnector);
  }

  async onModuleInit() {
    await this.refreshFromDefinitions();
  }

  private register(connector: ConnectorInterface) {
    this.connectors.set(connector.slug, connector);
  }

  private registerSafeFallbackSet(reason: string) {
    this.connectors.clear();
    const safeFallbackSlugs = resolveSafeConnectorFallbackSlugs();
    for (const slug of safeFallbackSlugs) {
      const implementation = this.implementationMap.get(slug);
      if (implementation) {
        this.register(implementation);
      }
    }
    this.logger.warn("Connector registry is using the safe fallback connector set.", {
      reason,
      slugs: safeFallbackSlugs,
      registered: Array.from(this.connectors.keys()),
    });
  }

  private async refreshFromDefinitions(): Promise<void> {
    try {
      const rows = await this.prisma.tenant().connectorDefinition.findMany({
        where: {
          isActive: true,
        },
        take: 100, // defensive cap — connector definitions are a small fixed catalogue
        select: {
          slug: true,
        },
      });
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
        this.registerSafeFallbackSet("connector_definitions_empty_or_unmapped");
      }
    } catch (error: unknown) {
      this.logger.warn("Connector definition discovery failed, using safe fallback connector set.");
      this.logger.info("Connector definition discovery fallback reason.", {
        reason: error instanceof Error ? error.message : String(error ?? "unknown_error"),
      });
      this.registerSafeFallbackSet("connector_definition_discovery_failed");
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
