import { Injectable, OnModuleInit } from "@nestjs/common";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { BigCommerceConnector } from "../connectors/bigcommerce/bigcommerce.connector";
import { Dynamics365Connector } from "../connectors/dynamics365/dynamics365.connector";
import { EbayConnector } from "../connectors/ebay/ebay.connector";
import { EtsyConnector } from "../connectors/etsy/etsy.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MeeshoConnector } from "../connectors/meesho/meesho.connector";
import { MyntraConnector } from "../connectors/myntra/myntra.connector";
import { NykaaConnector } from "../connectors/nykaa/nykaa.connector";
import { OdooConnector } from "../connectors/odoo/odoo.connector";
import { PrestaShopConnector } from "../connectors/prestashop/prestashop.connector";
import { ShopifyConnector } from "../connectors/shopify/shopify.connector";
import { ShopwareConnector } from "../connectors/shopware/shopware.connector";
import { WooCommerceConnector } from "../connectors/woocommerce/woocommerce.connector";
import { ZohoInventoryConnector } from "../connectors/zoho-inventory/zoho-inventory.connector";
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
    bigcommerceConnector: BigCommerceConnector,
    dynamics365Connector: Dynamics365Connector,
    ebayConnector: EbayConnector,
    etsyConnector: EtsyConnector,
    flipkartConnector: FlipkartConnector,
    meeshoConnector: MeeshoConnector,
    myntraConnector: MyntraConnector,
    nykaaConnector: NykaaConnector,
    odooConnector: OdooConnector,
    prestashopConnector: PrestaShopConnector,
    shopifyConnector: ShopifyConnector,
    shopwareConnector: ShopwareConnector,
    wooCommerceConnector: WooCommerceConnector,
    zohoInventoryConnector: ZohoInventoryConnector,
  ) {
    this.implementationMap.set(amazonConnector.slug, amazonConnector);
    this.implementationMap.set(bigcommerceConnector.slug, bigcommerceConnector);
    this.implementationMap.set(dynamics365Connector.slug, dynamics365Connector);
    this.implementationMap.set(ebayConnector.slug, ebayConnector);
    this.implementationMap.set(etsyConnector.slug, etsyConnector);
    this.implementationMap.set(flipkartConnector.slug, flipkartConnector);
    this.implementationMap.set(meeshoConnector.slug, meeshoConnector);
    this.implementationMap.set(myntraConnector.slug, myntraConnector);
    this.implementationMap.set(nykaaConnector.slug, nykaaConnector);
    this.implementationMap.set(odooConnector.slug, odooConnector);
    this.implementationMap.set(prestashopConnector.slug, prestashopConnector);
    this.implementationMap.set(shopifyConnector.slug, shopifyConnector);
    this.implementationMap.set(shopwareConnector.slug, shopwareConnector);
    this.implementationMap.set(wooCommerceConnector.slug, wooCommerceConnector);
    this.implementationMap.set(zohoInventoryConnector.slug, zohoInventoryConnector);
  }

  async onModuleInit() {
    await this.refreshFromDefinitions();
  }

  private register(connector: ConnectorInterface) {
    this.connectors.set(connector.slug, connector);
  }

  /**
   * CTO review remediation (CODE-003): falling back to a reduced connector set
   * used to be silent in every environment — a production deployment could
   * boot showing fewer channels than promised with only a log line to notice.
   * Staging/production now refuse to boot on fallback instead; development
   * keeps the previous lenient behavior so local work isn't blocked by an
   * empty/unseeded local connector-definition table.
   */
  private registerSafeFallbackSet(reason: string) {
    const appEnv = String(process.env.APP_ENV ?? "development").trim().toLowerCase();
    if (appEnv === "staging" || appEnv === "production") {
      throw new Error(
        `ConnectorRegistry: connector definitions fell back to the safe set (reason: ${reason}). ` +
          "Refusing to boot in staging/production with a degraded connector catalogue — sellers would " +
          "see fewer channels than expected. Fix the connector-definition data/DB connectivity and restart.",
      );
    }
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
