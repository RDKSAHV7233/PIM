import type { ProductPayload } from "../../connector-framework/connector.interface";
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
