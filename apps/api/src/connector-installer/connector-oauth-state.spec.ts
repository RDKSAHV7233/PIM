import {
  signConnectorOAuthState,
  verifyConnectorOAuthState,
  generateOAuthNonce,
} from "./connector-oauth-state";

const TEST_JWT_SECRET = "test-secret-that-is-at-least-32-chars-long-for-hkdf";
const DIFFERENT_SECRET = "another-secret-that-is-at-least-32-chars-for-hkdf";

const basePayload = {
  tenantKey: "tenant_abc",
  installationId: "inst-001",
  connectorKey: "shopify",
};

// ---------------------------------------------------------------------------
// generateOAuthNonce
// ---------------------------------------------------------------------------

describe("generateOAuthNonce", () => {
  it("returns a 32-character hex string", () => {
    const nonce = generateOAuthNonce();
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique nonces", () => {
    const a = generateOAuthNonce();
    const b = generateOAuthNonce();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// signConnectorOAuthState
// ---------------------------------------------------------------------------

describe("signConnectorOAuthState", () => {
  it("returns a state token with dot-separated payload and signature", () => {
    const { stateToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    expect(stateToken).toContain(".");
    const parts = stateToken.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("returns a nonce and future expiresAt", () => {
    const { nonce, expiresAt } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("generates different tokens for each call (unique nonce)", () => {
    const a = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    const b = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    expect(a.stateToken).not.toBe(b.stateToken);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

// ---------------------------------------------------------------------------
// verifyConnectorOAuthState
// ---------------------------------------------------------------------------

describe("verifyConnectorOAuthState", () => {
  it("verifies a valid token", () => {
    const { stateToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    const result = verifyConnectorOAuthState(stateToken, TEST_JWT_SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.tenantKey).toBe("tenant_abc");
      expect(result.payload.installationId).toBe("inst-001");
      expect(result.payload.connectorKey).toBe("shopify");
      expect(result.payload.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(result.payload.exp).toBeGreaterThan(Date.now());
    }
  });

  it("rejects a token signed with a different secret", () => {
    const { stateToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    const result = verifyConnectorOAuthState(stateToken, DIFFERENT_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("INVALID_SIGNATURE");
    }
  });

  it("rejects a tampered payload", () => {
    const { stateToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    const [, sig] = stateToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...basePayload, nonce: "tampered", exp: Date.now() + 999999 }),
    ).toString("base64url");
    const result = verifyConnectorOAuthState(`${tamperedPayload}.${sig}`, TEST_JWT_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("INVALID_SIGNATURE");
    }
  });

  it("rejects a tampered signature", () => {
    const { stateToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    const [payload] = stateToken.split(".");
    const result = verifyConnectorOAuthState(`${payload}.dGFtcGVyZWQ`, TEST_JWT_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("INVALID_SIGNATURE");
    }
  });

  it("rejects an expired token", () => {
    const { stateToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    const [payloadEncoded, sig] = stateToken.split(".");
    const decoded = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
    decoded.exp = Date.now() - 1000;
    const reEncoded = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    // Re-sign with correct key to test expiry check specifically
    const { stateToken: expiredToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
    // Instead, directly manipulate the test by checking behavior of a manually-expired token
    // We'll create a properly-signed but expired token by mocking Date.now
    const originalDateNow = Date.now;
    try {
      Date.now = () => originalDateNow() - 11 * 60 * 1000;
      const { stateToken: pastToken } = signConnectorOAuthState(basePayload, TEST_JWT_SECRET);
      Date.now = originalDateNow;
      const result = verifyConnectorOAuthState(pastToken, TEST_JWT_SECRET);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("STATE_EXPIRED");
      }
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("rejects a token with missing dot separator", () => {
    const result = verifyConnectorOAuthState("nodothere", TEST_JWT_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("MALFORMED_STATE");
    }
  });

  it("rejects an empty string", () => {
    const result = verifyConnectorOAuthState("", TEST_JWT_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("MALFORMED_STATE");
    }
  });

  it("rejects a token with invalid base64url payload", () => {
    const result = verifyConnectorOAuthState("!!!invalid!!!.dGVzdA", TEST_JWT_SECRET);
    expect(result.valid).toBe(false);
  });

  it("rejects a token with valid signature but missing required fields", () => {
    // Create a validly-signed token with an incomplete payload
    const { createHmac, hkdfSync } = require("node:crypto");
    const key = Buffer.from(hkdfSync("sha256", TEST_JWT_SECRET, "", "connector-oauth-state-v1", 32));
    const incompletePayload = Buffer.from(JSON.stringify({ tenantKey: "test" })).toString("base64url");
    const hmac = createHmac("sha256", key).update(incompletePayload).digest();
    const hmacEncoded = hmac.toString("base64url");
    const result = verifyConnectorOAuthState(`${incompletePayload}.${hmacEncoded}`, TEST_JWT_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("MALFORMED_STATE_PAYLOAD");
    }
  });

  it("preserves all payload fields through round-trip", () => {
    const customPayload = {
      tenantKey: "org_xyz",
      installationId: "install-uuid-123",
      connectorKey: "woocommerce",
    };
    const { stateToken } = signConnectorOAuthState(customPayload, TEST_JWT_SECRET);
    const result = verifyConnectorOAuthState(stateToken, TEST_JWT_SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.tenantKey).toBe("org_xyz");
      expect(result.payload.installationId).toBe("install-uuid-123");
      expect(result.payload.connectorKey).toBe("woocommerce");
    }
  });
});
