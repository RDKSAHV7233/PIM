import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { Dynamics365Connector } from "./dynamics365.connector";

const TEST_KEY = "e".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new Dynamics365Connector(
    { getClient: () => mockDbClient } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

function makeConnector() {
  return makeConnectorWithDb({
    connectorCredential: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({}) },
  });
}

const credRow = (type: string, value: string) => ({
  credentialType: type,
  encryptedValue: `enc::v1:${Buffer.from(value).toString("base64")}`,
  keyVersion: "v1",
  status: "ACTIVE",
  expiresAt: null,
});

function findFirstByType(rows: Record<string, ReturnType<typeof credRow> | null>) {
  return jest.fn().mockImplementation(({ where }: { where: { credentialType: string } }) =>
    Promise.resolve(rows[where.credentialType] ?? null),
  );
}

function mockDecrypt() {
  jest
    .spyOn(require("../../connector-installer/credential-encryption.util"), "decryptCredentialValue")
    .mockImplementation((enc: unknown) => Buffer.from(String(enc).replace("enc::v1:", ""), "base64").toString("utf8"));
}

const baseProduct: ProductPayload = {
  sku: "BC-001",
  title: "Business Central mapped item",
  description: "An inventory item",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 49.5,
  mainImageUrl: "https://cdn.example.com/bc.jpg",
  attributes: { item_category_code: "FURNITURE" },
  productType: "generic",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "dynamics-365",
    getAccessToken: jest.fn().mockResolvedValue("a-real-access-token"),
    ...overrides,
  } as ConnectorContext;
}

describe("Dynamics365Connector.buildItemPayload", () => {
  it("maps title/sku/sellingPrice onto displayName/number/unitPrice", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildItemPayload(baseProduct);
    expect(payload.displayName).toBe("Business Central mapped item");
    expect(payload.number).toBe("BC-001");
    expect(payload.unitPrice).toBe(49.5);
    expect(payload.type).toBe("Inventory");
  });

  it("reads itemCategoryCode from attributes and defaults baseUnitOfMeasureCode/taxGroupCode", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildItemPayload(baseProduct);
    expect(payload.itemCategoryCode).toBe("FURNITURE");
    expect(payload.baseUnitOfMeasureCode).toBe("PCS");
    expect(payload.taxGroupCode).toBe("TAXABLE");
  });

  it("truncates number/displayName to Business Central's field limits", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildItemPayload({
      ...baseProduct,
      sku: "X".repeat(30),
      title: "Y".repeat(150),
    });
    expect((payload.number as string).length).toBe(20);
    expect((payload.displayName as string).length).toBe(100);
  });
});

describe("Dynamics365Connector.parseEnvironmentCompany", () => {
  it("splits 'Production|CRONUS IN' into environment and company name", () => {
    const connector = makeConnector();
    const [env, company] = (connector as any).parseEnvironmentCompany("Production|CRONUS IN");
    expect(env).toBe("Production");
    expect(company).toBe("CRONUS IN");
  });

  it("defaults environment to 'Production' when unspecified", () => {
    const connector = makeConnector();
    const [env] = (connector as any).parseEnvironmentCompany("");
    expect(env).toBe("Production");
  });
});

describe("Dynamics365Connector.validateProduct", () => {
  it("requires a title", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_DISPLAY_NAME")).toBe(true);
  });

  it("rejects a title over 100 characters", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, title: "x".repeat(101) });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "NAME_TOO_LONG")).toBe(true);
  });

  it("rejects a negative sellingPrice", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, sellingPrice: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_UNIT_PRICE")).toBe(true);
  });

  it("warns (not errors) when item_category_code is missing", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, attributes: {} });
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "MISSING_ITEM_CATEGORY")).toBe(true);
  });
});

describe("Dynamics365Connector.normaliseError", () => {
  it("maps a known Business Central error code to a seller-friendly message", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("Internal_ItemWithSameNumberExists", "raw");
    expect(issue.sellerMessage).toMatch(/already exists/i);
  });

  it("falls back to a generic message for an unmapped error code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("Some_Unknown_Code", "raw detail");
    expect(issue.sellerMessage).toMatch(/raw detail/);
  });
});

describe("Dynamics365Connector auth transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("refreshAccessToken uses client_credentials grant against the correct Azure AD tenant endpoint", async () => {
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          aad_tenant: credRow("aad_tenant", "d8d859f1-0776-4dd2-9af3-cd75c7e20fa7"),
          client_id: credRow("client_id", "070ab931-6bb1-4710-9475-21dbd4d24273"),
          client_secret: credRow("client_secret", "a-real-secret"),
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "new-access-token", expires_in: 3600 }),
    });
    (global as any).fetch = fetchMock;

    const token = await connector.refreshAccessToken(fakeCtx());

    expect(token).toBe("new-access-token");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://login.microsoftonline.com/d8d859f1-0776-4dd2-9af3-cd75c7e20fa7/oauth2/v2.0/token");
    const body = new URLSearchParams(calledInit.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("https://api.businesscentral.dynamics.com/.default");
  });

  it("resolveApiBase resolves the company GUID via a live lookup by name, not an opaque id", async () => {
    // Regression coverage for the real design decision: Business Central
    // addresses companies by GUID, but operators only know the display name
    // ("CRONUS IN") — this must resolve it via /companies, not require the
    // operator to already know the id.
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          environment_company: credRow("environment_company", "Production|CRONUS IN"),
        }),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          value: [
            { id: "11111111-1111-1111-1111-111111111111", name: "CRONUS IN" },
            { id: "22222222-2222-2222-2222-222222222222", name: "Other Co" },
          ],
        }),
    });
    (global as any).fetch = fetchMock;

    const base = await (connector as any).resolveApiBase(fakeCtx());

    expect(base).toBe(
      "https://api.businesscentral.dynamics.com/v2.0/Production/api/v2.0/companies(11111111-1111-1111-1111-111111111111)",
    );
  });

  it("validateStoredCredentialsDetailed reports invalid on a 401/403 from the Business Central API", async () => {
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          environment_company: credRow("environment_company", "Production|CRONUS IN"),
        }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    // resolveApiBase's own company-lookup call succeeds; the subsequent
    // /items call is what actually gets rejected.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ value: [{ id: "11111111-1111-1111-1111-111111111111", name: "CRONUS IN" }] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("invalid");
    expect((result as { outcome: "invalid"; reasonCode?: string }).reasonCode).toBe("HTTP_401");
  });

  it("verifyCandidateCredentials classifies an invalid_client AAD response as invalid, not unavailable", async () => {
    // Regression coverage: an untested branch of the AadTokenExchangeError
    // classification. A bad client_id/secret must read as "credentials are
    // wrong" (invalid), not "couldn't check right now" (unavailable) — the
    // install form surfaces these very differently to the operator.
    const connector = makeConnector();
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." }),
    });
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials({
      aad_tenant: "d8d859f1-0776-4dd2-9af3-cd75c7e20fa7",
      client_id: "070ab931-6bb1-4710-9475-21dbd4d24273",
      client_secret: "wrong-secret",
      environment_company: "Production|CRONUS IN",
    });

    expect(result.outcome).toBe("invalid");
    expect((result as { outcome: "invalid"; reasonCode?: string }).reasonCode).toBe("invalid_client");
    // Only the token endpoint is hit — an invalid_client failure must short-circuit
    // before ever reaching the companies lookup.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Dynamics365Connector.resolveApiBase", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("fails with a clear error when the configured company name doesn't match any company in the environment", async () => {
    // The task's own review note calls this out explicitly: resolution must
    // fail gracefully (a clear message naming the company + environment),
    // not throw an opaque "cannot read property 'id' of undefined".
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          environment_company: credRow("environment_company", "Production|Nonexistent Co"),
        }),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [{ id: "11111111-1111-1111-1111-111111111111", name: "CRONUS IN" }] }),
    });
    (global as any).fetch = fetchMock;

    await expect((connector as any).resolveApiBase(fakeCtx())).rejects.toThrow(
      /Business Central company 'Nonexistent Co' not found in environment 'Production'/,
    );
  });
});

describe("Dynamics365Connector.publishProduct / updateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  function dbWithEnvCompany() {
    return {
      connectorCredential: {
        findFirst: findFirstByType({
          environment_company: credRow("environment_company", "Production|CRONUS IN"),
        }),
      },
    };
  }

  const companyLookupResponse = {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ value: [{ id: "11111111-1111-1111-1111-111111111111", name: "CRONUS IN" }] }),
  };

  it("POSTs the mapped item payload to the resolved company's /items endpoint and returns the new item id as externalRef", async () => {
    // publishProduct had zero test coverage before this — the connector's
    // single most consequential call (it writes a real item into a tenant's
    // live ERP) was entirely unverified beyond the payload-mapping unit tests.
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithEnvCompany());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(companyLookupResponse)
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => JSON.stringify({ id: "item-guid-123", number: "BC-001" }) });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref).toEqual({ externalRef: "item-guid-123", status: "SUCCESS", isAsync: false });
    const [itemsUrl, itemsInit] = fetchMock.mock.calls[1];
    expect(itemsUrl).toBe(
      "https://api.businesscentral.dynamics.com/v2.0/Production/api/v2.0/companies(11111111-1111-1111-1111-111111111111)/items",
    );
    expect(itemsInit.method).toBe("POST");
    expect(JSON.parse(itemsInit.body)).toMatchObject({ number: "BC-001", displayName: baseProduct.title, unitPrice: 49.5 });
  });

  it("surfaces Business Central's duplicate-item OData error as the mapped seller-facing message, not a raw code", async () => {
    // Ties to the idempotency question this review was asked to check: unlike
    // Odoo, Business Central enforces uniqueness on the item's "No." (primary
    // key) itself, so a retried publish can't silently create a duplicate —
    // it fails, and must fail with the friendly message already defined in
    // ERROR_MESSAGES, not a raw OData error blob.
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithEnvCompany());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(companyLookupResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ error: { code: "Internal_ItemWithSameNumberExists", message: "An item with number BC-001 already exists." } }),
      });
    (global as any).fetch = fetchMock;

    await expect(connector.publishProduct(fakeCtx(), baseProduct)).rejects.toThrow(/already exists/i);
  });

  it("updateProduct PATCHes items(externalRef) with If-Match: * against the resolved company base", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithEnvCompany());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(companyLookupResponse)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ id: "item-guid-123" }) });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "item-guid-123");

    expect(ref).toEqual({ externalRef: "item-guid-123", status: "SUCCESS", isAsync: false });
    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe(
      "https://api.businesscentral.dynamics.com/v2.0/Production/api/v2.0/companies(11111111-1111-1111-1111-111111111111)/items(item-guid-123)",
    );
    expect(patchInit.method).toBe("PATCH");
    expect(patchInit.headers["If-Match"]).toBe("*");
  });
});
