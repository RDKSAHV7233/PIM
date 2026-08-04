import type { ProductPayload } from "../../connector-framework/connector.interface";
import { ConnectorNetworkError } from "../../connector-framework/connector.errors";
import { WooCommerceConnector } from "./woocommerce.connector";

function makeConnector() {
  return new WooCommerceConnector(
    { getClient: jest.fn() } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

describe("WooCommerceConnector product payload", () => {
  const baseProduct: ProductPayload = {
    sku: "WC-001",
    title: "Woo mapped product",
    description: "Woo product description",
    brand: "Vexa",
    hsnCode: "6204",
    gstRate: 12,
    mrp: 1299,
    sellingPrice: 999,
    mainImageUrl: "https://cdn.example.com/wc.jpg",
    attributes: {},
    productType: "Kurtas",
  };

  it("includes mapped customMeta entries in WooCommerce meta_data without overwriting reserved Vexa keys", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildWcProductPayload(
      {
        ...baseProduct,
        customMeta: [
          { key: "material", value: "Cotton" },
          { key: "fabric_care", value: "Machine wash" },
          { key: "_vexa_pim_product_id", value: "forged" },
        ],
      },
      [],
      [],
    );

    expect(payload.meta_data).toEqual(expect.arrayContaining([
      { key: "_vexa_pim_product_id", value: "WC-001" },
      { key: "_vexa_hsn_code", value: "6204" },
      { key: "material", value: "Cotton" },
      { key: "fabric_care", value: "Machine wash" },
    ]));
    expect(payload.meta_data.filter((entry: { key: string }) => entry.key === "_vexa_pim_product_id")).toHaveLength(1);
  });
});

describe("ConnectorNetworkError", () => {
  it("produces an actionable retry message for retryable errors", () => {
    const err = new ConnectorNetworkError("woocommerce", "TIMEOUT", true, "request exceeded 30000ms timeout");
    expect(err.message).toContain("retry automatically");
    expect(err.retryable).toBe(true);
    expect(err.category).toBe("TIMEOUT");
    expect(err.name).toBe("ConnectorNetworkError");
  });

  it("produces a credential-check message for non-retryable errors", () => {
    const err = new ConnectorNetworkError("woocommerce", "DNS", false, "DNS resolution failed (ENOTFOUND)");
    expect(err.message).toContain("Check your woocommerce store URL");
    expect(err.message).toContain("DNS resolution failed");
    expect(err.retryable).toBe(false);
    expect(err.category).toBe("DNS");
  });

  it("produces a credential-check message for TLS errors", () => {
    const err = new ConnectorNetworkError("woocommerce", "TLS", false, "TLS/certificate error (ERR_TLS_CERT_ALTNAME_INVALID)");
    expect(err.retryable).toBe(false);
    expect(err.category).toBe("TLS");
    expect(err.message).toContain("Check your woocommerce store URL");
  });

  it("produces an actionable retry message for NETWORK category", () => {
    const err = new ConnectorNetworkError("woocommerce", "NETWORK", true, "connection failed (ECONNRESET)");
    expect(err.retryable).toBe(true);
    expect(err.category).toBe("NETWORK");
    expect(err.message).toContain("retry automatically");
  });

  it("is an instance of Error", () => {
    const err = new ConnectorNetworkError("woocommerce", "TIMEOUT", true, "timeout");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConnectorNetworkError);
  });
});
