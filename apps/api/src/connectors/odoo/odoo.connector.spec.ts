import type { ProductPayload } from "../../connector-framework/connector.interface";
import { OdooConnector, OdooPublishError } from "./odoo.connector";

const TEST_KEY = "c".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new OdooConnector(
    { getClient: () => mockDbClient } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

function makeConnector() {
  return makeConnectorWithDb({
    connectorCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  });
}

const baseProduct: ProductPayload = {
  sku: "ODOO-001",
  title: "Odoo mapped product",
  description: "Odoo product description",
  brand: "Vexa",
  hsnCode: "6204",
  gstRate: 12,
  mrp: 1299,
  sellingPrice: 999,
  mainImageUrl: "https://cdn.example.com/odoo.jpg",
  attributes: {},
  productType: "generic",
};

describe("OdooConnector.buildPayload", () => {
  it("sends detailed_type 'consu', never the pre-Odoo-17 'product' value", () => {
    // Regression test for a real bug found porting this connector: Odoo 17
    // rejects detailed_type: "product" outright (`Wrong value for
    // product.template.detailed_type: 'product'`) — "consu" is the only
    // stock type available without the Inventory app.
    const connector = makeConnector();
    const payload = (connector as any).buildPayload(baseProduct);
    expect(payload.detailed_type).toBe("consu");
  });

  it("never sends an x_brand field — no generic brand field exists on stock product.template", () => {
    // Regression test: x_brand is a Studio/custom field that must be created
    // per Odoo instance; sending it against a fresh install fails with
    // "Invalid field 'x_brand' on model 'product.template'".
    const connector = makeConnector();
    const payload = (connector as any).buildPayload(baseProduct);
    expect(payload).not.toHaveProperty("x_brand");
  });

  it("maps sku/title/sellingPrice onto default_code/name/list_price", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildPayload(baseProduct);
    expect(payload.default_code).toBe("ODOO-001");
    expect(payload.name).toBe("Odoo mapped product");
    expect(payload.list_price).toBe(999);
    expect(payload.sale_ok).toBe(true);
    expect(payload.purchase_ok).toBe(true);
  });

  it("reads odoo_category_id and weight_kg from attributes, defaulting sensibly", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildPayload({
      ...baseProduct,
      attributes: { odoo_category_id: 5, weight_kg: 1.2, gtin: "0123456789012" },
    });
    expect(payload.categ_id).toBe(5);
    expect(payload.weight).toBe(1.2);
    expect(payload.barcode).toBe("0123456789012");
  });
});

describe("OdooConnector.normaliseError", () => {
  it("maps odoo.exceptions.AccessDenied to a credentials-field issue", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("odoo.exceptions.AccessDenied", "Access Denied");
    expect(issue.fieldPath).toBe("credentials");
    expect(issue.severity).toBe("error");
    expect(issue.sellerMessage).toMatch(/database, username, or password/i);
  });

  it("falls back to a generic message for an unmapped error code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("some.unknown.Error", "raw detail");
    expect(issue.code).toBe("some.unknown.Error");
    expect(issue.sellerMessage).toMatch(/raw detail/);
  });
});

describe("OdooConnector.validateProduct", () => {
  it("requires a title", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "ODOO_NAME_REQUIRED")).toBe(true);
    expect(result.source).toBe("LOCAL_RULES");
  });

  it("rejects a negative selling price", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, sellingPrice: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "ODOO_LIST_PRICE_REQUIRED")).toBe(true);
  });

  it("warns (not errors) when sku is missing", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, sku: "" });
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "ODOO_REFERENCE_RECOMMENDED")).toBe(true);
  });

  it("accepts a fully valid product", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("OdooConnector auth transport", () => {
  const credRow = (type: string, value: string) => ({ credentialType: type, encryptedValue: `enc::v1:${Buffer.from(value).toString("base64")}`, keyVersion: "v1" });

  function mockDecrypt(values: Record<string, string>) {
    jest.spyOn(require("../../connector-installer/credential-encryption.util"), "decryptCredentialValue")
      .mockImplementation((enc: unknown) => {
        const raw = Buffer.from(String(enc).replace("enc::v1:", ""), "base64").toString("utf8");
        return raw;
      });
    return values;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("validateCredentials calls /jsonrpc's common.authenticate — NOT /web/session/authenticate", async () => {
    // The real bug this connector was ported to fix: /web/session/authenticate
    // rejects Odoo API keys by design (Odoo's own _check_credentials only
    // checks res.users.apikeys on the non-interactive path). Verified live
    // against a real Odoo 17 instance during the prototype phase.
    const db = {
      connectorCredential: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(credRow("odoo_url", "https://odoo.example.com"))
          .mockResolvedValueOnce(credRow("database", "odoo"))
          .mockResolvedValueOnce(credRow("username", "admin"))
          .mockResolvedValueOnce(credRow("password", "a-real-api-key")),
      },
    };
    mockDecrypt({});
    const connector = makeConnectorWithDb(db);

    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: "2.0", id: 1, result: 2 }),
    });
    (global as any).fetch = fetchMock;

    const ok = await connector.validateCredentials({ tenantId: "t1", installationId: "i1", connectorId: "odoo" } as any);

    expect(ok).toBe(true);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://odoo.example.com/jsonrpc");
    const body = JSON.parse(calledInit.body);
    expect(body.params.service).toBe("common");
    expect(body.params.method).toBe("authenticate");
    expect(body.params.args).toEqual(["odoo", "admin", "a-real-api-key", {}]);
  });

  it("validateCredentials returns false when common.authenticate resolves to false (bad creds, not an exception)", async () => {
    const db = {
      connectorCredential: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(credRow("odoo_url", "https://odoo.example.com"))
          .mockResolvedValueOnce(credRow("database", "odoo"))
          .mockResolvedValueOnce(credRow("username", "admin"))
          .mockResolvedValueOnce(credRow("password", "wrong")),
      },
    };
    mockDecrypt({});
    const connector = makeConnectorWithDb(db);
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: "2.0", id: 1, result: false }),
    });

    const ok = await connector.validateCredentials({ tenantId: "t1", installationId: "i1", connectorId: "odoo" } as any);
    expect(ok).toBe(false);
  });

  it("publishProduct raises an OdooPublishError with a seller-friendly message on an RPC error", async () => {
    const db = {
      connectorCredential: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(credRow("odoo_url", "https://odoo.example.com"))
          .mockResolvedValueOnce(credRow("database", "odoo"))
          .mockResolvedValueOnce(credRow("username", "admin"))
          .mockResolvedValueOnce(credRow("password", "a-real-api-key")),
      },
    };
    mockDecrypt({});
    const connector = makeConnectorWithDb(db);

    (global as any).fetch = jest.fn()
      .mockResolvedValueOnce({ json: async () => ({ jsonrpc: "2.0", id: 1, result: 2 }) }) // authenticate
      .mockResolvedValueOnce({
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: 200, message: "Odoo Server Error", data: { name: "odoo.exceptions.ValidationError", message: "Invalid record" } },
        }),
      }); // execute_kw create

    await expect(
      connector.publishProduct({ tenantId: "t1", installationId: "i1", connectorId: "odoo" } as any, baseProduct),
    ).rejects.toBeInstanceOf(OdooPublishError);
  });
});
