import "reflect-metadata";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorCredentialEncryptionService } from "../connector-installer/credential-encryption.service";
import { AmazonConnector } from "../connectors/amazon/amazon.connector";
import { BigCommerceConnector } from "../connectors/bigcommerce/bigcommerce.connector";
import { Dynamics365Connector } from "../connectors/dynamics365/dynamics365.connector";
import { EbayConnector } from "../connectors/ebay/ebay.connector";
import { EtsyConnector } from "../connectors/etsy/etsy.connector";
import { FlipkartConnector } from "../connectors/flipkart/flipkart.connector";
import { MyntraConnector } from "../connectors/myntra/myntra.connector";
import { OdooConnector } from "../connectors/odoo/odoo.connector";
import { PrestaShopConnector } from "../connectors/prestashop/prestashop.connector";
import { ShopifyConnector } from "../connectors/shopify/shopify.connector";
import { ShopwareConnector } from "../connectors/shopware/shopware.connector";
import { WooCommerceBrownfieldImportService } from "../connectors/woocommerce/woocommerce-brownfield-import.service";
import { WooCommerceBulkPublishService } from "../connectors/woocommerce/woocommerce-bulk-publish.service";
import { WooCommerceConnector } from "../connectors/woocommerce/woocommerce.connector";
import { ZohoInventoryConnector } from "../connectors/zoho-inventory/zoho-inventory.connector";

/**
 * SEC-DB-RLS-001 M1c: production wiring of the tenant client.
 *
 * These classes take `PrismaService` as an OPTIONAL constructor parameter, and `tenantDb` falls back to the context-free direct client
 * when it is absent. That fallback exists only for tests that build a class by hand. Nest decides what to inject from the constructor's
 * emitted parameter types, so as long as `PrismaService` is among them the fallback is unreachable in the running application.
 *
 * This pins that fact: if a refactor drops or retypes the parameter (for example to `unknown` or an interface, which emits `Object`),
 * Nest would silently stop injecting the tenant client and every connector would fall back to the direct client, which sees no
 * tenant's rows under a restricted role. That change fails here instead.
 */
describe("tenant client wiring of the connectors (SEC-DB-RLS-001 M1c)", () => {
  const classes: Array<[string, new (...args: never[]) => unknown]> = [
    ["ConnectorCredentialEncryptionService", ConnectorCredentialEncryptionService],
    ["AmazonConnector", AmazonConnector],
    ["BigCommerceConnector", BigCommerceConnector],
    ["Dynamics365Connector", Dynamics365Connector],
    ["EbayConnector", EbayConnector],
    ["EtsyConnector", EtsyConnector],
    ["FlipkartConnector", FlipkartConnector],
    ["MyntraConnector", MyntraConnector],
    ["OdooConnector", OdooConnector],
    ["PrestaShopConnector", PrestaShopConnector],
    ["ShopifyConnector", ShopifyConnector],
    ["ShopwareConnector", ShopwareConnector],
    ["WooCommerceBrownfieldImportService", WooCommerceBrownfieldImportService],
    ["WooCommerceBulkPublishService", WooCommerceBulkPublishService],
    ["WooCommerceConnector", WooCommerceConnector],
    ["ZohoInventoryConnector", ZohoInventoryConnector],
  ];

  it.each(classes)("%s has PrismaService among its injected constructor parameters", (_name, cls) => {
    const paramTypes = (Reflect.getMetadata("design:paramtypes", cls) ?? []) as unknown[];
    expect(paramTypes).toContain(PrismaService);
  });

  it("covers every class that still has the optional tenant-client parameter", () => {
    // Guards the list above: a new connector copying the pattern must be added here, not forgotten.
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const root = path.resolve(__dirname, "..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") && fs.readFileSync(full, "utf8").includes("private readonly prisma?: PrismaService")) {
          found.push(path.relative(root, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(root);
    expect(found).toHaveLength(classes.length);
  });
});
