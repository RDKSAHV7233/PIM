// flipkart.connector.spec.ts
// Unit tests for FlipkartConnector: normaliseError, validateProduct local rules,
// refreshAccessToken OAuth exchange, validateCredentials credential check.

import { FlipkartConnector } from "./flipkart.connector";
import { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";

// ─── helpers ──────────────────────────────────────────────────────────────────

const TEST_KEY = "c".repeat(64); // 64 hex chars = 32-byte AES key

function makeConnector(): FlipkartConnector {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";

  const mockDbClient = {
    connectorCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]), // RLS-BYPASS: manual tenant filter — test mock
    $executeRawUnsafe: jest.fn().mockResolvedValue(1), // RLS-BYPASS: manual tenant filter — test mock
  };
  const prismaDirect = { getClient: () => mockDbClient } as any;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  return new FlipkartConnector(prismaDirect, logger);
}

function makeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "tenant-1",
    installationId: "install-1",
    connectorId: "conn-1",
    getAccessToken: jest.fn().mockResolvedValue("mock-access-token"),
    fetch: jest.fn(),
    ...overrides,
  };
}

// Base product that passes all Flipkart local rules (using 'default' category
// to avoid apparel-specific required fields like attributes.material).
// Includes all BASE_FIELDS required attributes (packageWeight, etc.).
const BASE_PRODUCT: ProductPayload = {
  sku: "FK-TEST-001",
  title: "Cotton Kurti for Women",
  description: "Comfortable daily-wear cotton kurti. Machine washable.",
  brand: "TestBrand",
  hsnCode: "62044200",
  gstRate: 5,
  mrp: 999,
  sellingPrice: 799,
  mainImageUrl: "https://cdn.example.com/img/001.jpg",
  attributes: {
    color: "Blue",
    size: "M",
    packageWeight: 300,
    packageLength: 30,
    packageBreadth: 20,
    packageHeight: 5,
    procurementSla: 2,
    procurementType: "REGULAR",
  },
  productType: "default", // 'default' avoids apparel-specific required fields
};

// ─── normaliseError ────────────────────────────────────────────────────────────

describe("FlipkartConnector.normaliseError", () => {
  let connector: FlipkartConnector;
  beforeEach(() => { connector = makeConnector(); });

  it("returns a ConnectorIssue with required fields", () => {
    const issue = connector.normaliseError("CATEGORY_MISMATCH", "Category is wrong");
    expect(issue).toMatchObject({
      code: expect.any(String),
      fieldPath: expect.any(String),
      severity: expect.stringMatching(/^error|warning$/),
      sellerMessage: expect.any(String),
    });
  });

  it("upper-cases the error code", () => {
    const issue = connector.normaliseError("category_mismatch", "msg");
    expect(issue.code).toBe(issue.code.toUpperCase());
  });

  it("falls back to UNKNOWN_ERROR for empty code", () => {
    const issue = connector.normaliseError("", "msg");
    expect(issue.code).toBe("UNKNOWN_ERROR");
  });

  it("returns seller-readable message for known CATEGORY_MISMATCH code", () => {
    const issue = connector.normaliseError("CATEGORY_MISMATCH", "raw error");
    expect(issue.sellerMessage).not.toBe("raw error"); // uses friendly message
    expect(issue.sellerMessage.length).toBeGreaterThan(0);
  });

  it("uses rawMessage for unknown codes when rawMessage is non-empty", () => {
    const issue = connector.normaliseError("SOME_UNKNOWN_CODE", "specific error detail");
    // unknown code + non-empty rawMessage → rawMessage
    expect(issue.sellerMessage).toBe("specific error detail");
  });

  it("generates a fallback message for unknown codes with empty rawMessage", () => {
    const issue = connector.normaliseError("SOME_UNKNOWN_CODE", "");
    // unknown code + empty rawMessage → generated fallback mentioning the code
    expect(issue.sellerMessage.toLowerCase()).toContain("flipkart");
  });

  it("never returns empty sellerMessage", () => {
    const issue = connector.normaliseError("", "");
    expect(issue.sellerMessage.length).toBeGreaterThan(0);
  });
});

// ─── validateProduct (local rules) ────────────────────────────────────────────

describe("FlipkartConnector.validateProduct — local rules", () => {
  let connector: FlipkartConnector;
  const ctx = makeCtx();
  beforeEach(() => { connector = makeConnector(); });

  it("passes a fully valid product with no errors", async () => {
    const result = await connector.validateProduct(ctx, BASE_PRODUCT);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.source).toBe("LOCAL_RULES");
  });

  it("fails when title is missing", async () => {
    const result = await connector.validateProduct(ctx, { ...BASE_PRODUCT, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath.toLowerCase().includes("title"))).toBe(true);
  });

  it("fails when mainImageUrl is missing", async () => {
    const result = await connector.validateProduct(ctx, { ...BASE_PRODUCT, mainImageUrl: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) =>
      e.fieldPath.toLowerCase().includes("image") || e.fieldPath.toLowerCase().includes("mainimage")
    )).toBe(true);
  });

  it("fails when brand is missing", async () => {
    const result = await connector.validateProduct(ctx, { ...BASE_PRODUCT, brand: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath.toLowerCase().includes("brand"))).toBe(true);
  });

  it("fails when mainImageUrl uses HTTP instead of HTTPS", async () => {
    const result = await connector.validateProduct(ctx, {
      ...BASE_PRODUCT,
      mainImageUrl: "http://cdn.example.com/img/001.jpg",
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "IMAGE_URL_NOT_HTTPS")).toBe(true);
  });

  it("warns (not errors) when sellingPrice exceeds mrp", async () => {
    const result = await connector.validateProduct(ctx, {
      ...BASE_PRODUCT,
      sellingPrice: 1500,
      mrp: 999,
    });
    // Flipkart treats sellingPrice > mrp as a warning, not an error
    expect(result.warnings.some((w) => w.code === "SELLING_PRICE_GT_MRP")).toBe(true);
    // Product is still valid (not blocked)
    expect(result.isValid).toBe(true);
  });

  it("returns arrays for errors and warnings even on valid product", async () => {
    const result = await connector.validateProduct(ctx, BASE_PRODUCT);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("reports source as LOCAL_RULES", async () => {
    const result = await connector.validateProduct(ctx, BASE_PRODUCT);
    expect(result.source).toBe("LOCAL_RULES");
  });
});

// ─── refreshAccessToken ────────────────────────────────────────────────────────

describe("FlipkartConnector.refreshAccessToken", () => {
  async function buildEncryptedRow(value: string) {
    const {
      encryptCredentialValue,
      loadCredentialEncryptionKeys,
      resolveCurrentCredentialKeyVersion,
    } = await import("../../connector-installer/credential-encryption.util");
    const keys = loadCredentialEncryptionKeys(process.env);
    const ver = resolveCurrentCredentialKeyVersion(process.env);
    return {
      id: "cred-x",
      encryptedValue: encryptCredentialValue(value, keys.get(ver)!, ver),
      keyVersion: "v1",
      status: "ACTIVE",
      expiresAt: null,
      failureReason: null,
    };
  }

  it("exchanges OAuth credentials and returns the access token", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();

    db.connectorCredential.findFirst.mockImplementation(
      async ({ where }: { where: { credentialType: string } }) => {
        const map: Record<string, string> = {
          client_id: "flipkart-client-id",
          client_secret: "flipkart-secret",
          refresh_token: "fk-refresh-token-xyz",
        };
        const val = map[where.credentialType];
        return val ? await buildEncryptedRow(val) : null;
      },
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: "fk-access-token-new",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    } as any);

    const ctx = makeCtx();
    const token = await connector.refreshAccessToken(ctx);

    expect(token).toBe("fk-access-token-new");
    expect(db.connectorCredential.upsert).toHaveBeenCalled();
  });

  it("throws REFRESH_TOKEN_EXPIRED when server returns 401 and token is expired", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();

    const expiredDate = new Date(Date.now() - 1000); // past date
    db.connectorCredential.findFirst.mockImplementation(
      async ({ where }: { where: { credentialType: string } }) => {
        const map: Record<string, string> = {
          client_id: "id", client_secret: "secret", refresh_token: "expired-token",
        };
        const val = map[where.credentialType];
        if (!val) return null;
        const row = await buildEncryptedRow(val);
        // Return expired refresh token
        if (where.credentialType === "refresh_token") {
          return { ...row, expiresAt: expiredDate };
        }
        return row;
      },
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    } as any);

    const ctx = makeCtx();
    await expect(connector.refreshAccessToken(ctx)).rejects.toThrow(/REFRESH_TOKEN_EXPIRED/i);
  });

  it("throws when token exchange response is missing access_token", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();

    db.connectorCredential.findFirst.mockImplementation(
      async ({ where }: { where: { credentialType: string } }) => {
        const map: Record<string, string> = {
          client_id: "id", client_secret: "secret", refresh_token: "token",
        };
        const val = map[where.credentialType];
        return val ? await buildEncryptedRow(val) : null;
      },
    );

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: "server_error" }),
    } as any);

    const ctx = makeCtx();
    await expect(connector.refreshAccessToken(ctx)).rejects.toThrow(/access_token/i);
  });
});

// ─── verifyCandidateCredentials ────────────────────────────────────────────────

describe("FlipkartConnector.verifyCandidateCredentials", () => {
  const candidate = {
    client_id: "candidate-client-id",
    client_secret: "candidate-client-secret",
    refresh_token: "candidate-refresh-token",
  };

  it("returns valid with commitExtra sourced from the exchange response, not the candidate input", async () => {
    const connector = makeConnector();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: "fresh-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
        refresh_token_expires_in: 2_592_000,
      }),
    } as any);

    const result = await connector.verifyCandidateCredentials!(candidate);

    expect(result.outcome).toBe("valid");
    if (result.outcome === "valid") {
      expect(result.commitExtra?.accessToken?.value).toBe("fresh-access-token");
      // Rotated: the response's refresh_token differs from the submitted candidate — the
      // commit value must come from the response, never silently stay the submitted one.
      expect(result.commitExtra?.refreshToken?.value).toBe("rotated-refresh-token");
    }
  });

  it("omits commitExtra.refreshToken when the exchange response didn't rotate it", async () => {
    const connector = makeConnector();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "fresh-access-token", expires_in: 3600 }),
    } as any);

    const result = await connector.verifyCandidateCredentials!(candidate);

    expect(result.outcome).toBe("valid");
    if (result.outcome === "valid") {
      expect(result.commitExtra?.refreshToken).toBeUndefined();
    }
  });

  it("returns invalid on a bare 401", async () => {
    const connector = makeConnector();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({}),
    } as any);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "HTTP_401",
    });
  });

  it("returns invalid on an explicit invalid_grant OAuth error body", async () => {
    const connector = makeConnector();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    } as any);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "invalid_grant",
    });
  });

  it("returns unavailable (not invalid) on a network/timeout failure", async () => {
    const connector = makeConnector();
    global.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "UNKNOWN_NETWORK_ERROR",
    });
  });

  it("returns unavailable on an opaque 400 with no interpretable error body", async () => {
    const connector = makeConnector();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "",
    } as any);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "HTTP_400",
    });
  });

  it("candidate-purity: calls the token endpoint with the candidate's own values, not any stored credential", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "tok", expires_in: 3600 }),
    } as any);

    await connector.verifyCandidateCredentials!(candidate);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = fetchCall[1].body as URLSearchParams;
    expect(body.get("refresh_token")).toBe(candidate.refresh_token);
    const authHeader = fetchCall[1].headers.Authorization as string;
    expect(authHeader).toBe(`Basic ${Buffer.from(`${candidate.client_id}:${candidate.client_secret}`).toString("base64")}`);
    // Purity: never touches stored credential rows.
    expect(db.connectorCredential.findFirst).not.toHaveBeenCalled();
    expect(db.connectorCredential.updateMany).not.toHaveBeenCalled();
    expect(db.connectorCredential.upsert).not.toHaveBeenCalled();
  });
});

// ─── connector metadata ───────────────────────────────────────────────────────

describe("FlipkartConnector metadata", () => {
  it("has slug 'flipkart'", () => {
    expect(makeConnector().slug).toBe("flipkart");
  });

  it("declares PUBLISH, VALIDATE, STATUS_SYNC, EXCEL_EXPORT capabilities", () => {
    const caps = makeConnector().capabilities;
    expect(caps).toContain("PUBLISH");
    expect(caps).toContain("VALIDATE");
    expect(caps).toContain("STATUS_SYNC");
    expect(caps).toContain("EXCEL_EXPORT");
  });

  it("does not declare WEBHOOK_RECEIVE (Flipkart uses polling)", () => {
    expect(makeConnector().capabilities).not.toContain("WEBHOOK_RECEIVE");
  });
});
