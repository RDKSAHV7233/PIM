import {
  MEDIA_READ_PURPOSE,
  MEDIA_TOKEN_DEFAULT_TTL_SECONDS,
  MEDIA_TOKEN_MAX_TTL_SECONDS,
  MediaTokenError,
  isMediaSigningConfigured,
  mediaTokenQuery,
  resolveMediaTokenTtlSeconds,
  signMediaToken,
  verifyMediaToken,
} from "./media-url-token";

const KEY = "media-signing-key-for-tests-0123456789";
const OTHER_KEY = "a-different-media-signing-key-0123456789";
const ENV = { MEDIA_URL_SIGNING_KEY: KEY } as NodeJS.ProcessEnv;
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

const reason = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof MediaTokenError) {
      return error.reason;
    }
    throw error;
  }
  return "NO_ERROR";
};

const tamper = (token: string, index: 1 | 2, replace: (s: string) => string) => {
  const parts = token.split(".");
  parts[index] = replace(parts[index]);
  return parts.join(".");
};

describe("media token (SEC-DB-RLS-001 D1)", () => {
  it("round-trips: the verified claims are exactly the tenant and asset that were signed, plus an expiry", () => {
    const token = signMediaToken({ tenantKey: "tenant-b", assetId: "asset-1", nowMs: NOW }, ENV);
    const claims = verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW + 1000 }, ENV);
    expect(claims).toEqual({ tenantKey: "tenant-b", assetId: "asset-1", expiresAt: Math.floor(NOW / 1000) + MEDIA_TOKEN_DEFAULT_TTL_SECONDS });
  });

  it("binds the tenant: a token for tenant-a never verifies as tenant-b", () => {
    const token = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", nowMs: NOW }, ENV);
    expect(verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW }, ENV).tenantKey).toBe("tenant-a");
  });

  it("rejects a token presented for a DIFFERENT asset", () => {
    const token = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", nowMs: NOW }, ENV);
    expect(reason(() => verifyMediaToken(token, { assetId: "asset-2", nowMs: NOW }, ENV))).toBe("WRONG_ASSET");
  });

  it("rejects an expired token, and accepts it up to the second before expiry", () => {
    const token = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", ttlSeconds: 3600, nowMs: NOW }, ENV);
    expect(reason(() => verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW + 3599 * 1000 }, ENV))).toBe("NO_ERROR");
    expect(reason(() => verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW + 3600 * 1000 }, ENV))).toBe("EXPIRED");
    expect(reason(() => verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW + 8 * 24 * 3600 * 1000 }, ENV))).toBe("EXPIRED");
  });

  it("rejects a tampered payload (a caller cannot switch the tenant) and a tampered signature", () => {
    const token = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", nowMs: NOW }, ENV);
    const forgedPayload = Buffer.from(JSON.stringify({ t: "tenant-victim", a: "asset-1", p: MEDIA_READ_PURPOSE, e: Math.floor(NOW / 1000) + 99999 })).toString("base64url");
    expect(reason(() => verifyMediaToken(tamper(token, 1, () => forgedPayload), { assetId: "asset-1", nowMs: NOW }, ENV))).toBe("BAD_SIGNATURE");
    expect(reason(() => verifyMediaToken(tamper(token, 2, (s) => `${s.slice(0, -2)}AA`), { assetId: "asset-1", nowMs: NOW }, ENV))).toBe("BAD_SIGNATURE");
  });

  it("rejects a token signed with a different key", () => {
    const token = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", nowMs: NOW }, { MEDIA_URL_SIGNING_KEY: OTHER_KEY } as NodeJS.ProcessEnv);
    expect(reason(() => verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW }, ENV))).toBe("BAD_SIGNATURE");
  });

  it("rejects a correctly signed token whose purpose is not media-read", () => {
    const { createHmac } = jest.requireActual("node:crypto") as typeof import("node:crypto");
    const payload = Buffer.from(JSON.stringify({ t: "tenant-a", a: "asset-1", p: "something-else", e: Math.floor(NOW / 1000) + 600 })).toString("base64url");
    const head = `v1.${payload}`;
    const token = `${head}.${createHmac("sha256", KEY).update(head).digest().toString("base64url")}`;
    expect(reason(() => verifyMediaToken(token, { assetId: "asset-1", nowMs: NOW }, ENV))).toBe("WRONG_PURPOSE");
  });

  it.each([
    ["undefined", undefined, "MISSING"],
    ["null", null, "MISSING"],
    ["empty", "", "MISSING"],
    ["whitespace", "   ", "MISSING"],
    ["no dots", "abc", "MALFORMED"],
    ["two parts", "v1.abc", "MALFORMED"],
    ["wrong version", "v2.abc.def", "MALFORMED"],
    ["empty parts", "v1..", "MALFORMED"],
  ])("rejects a missing or malformed token (%s)", (_label, token, expected) => {
    expect(reason(() => verifyMediaToken(token as never, { assetId: "asset-1", nowMs: NOW }, ENV))).toBe(expected);
  });

  it("does not verify, and does not sign, when no signing key is configured", () => {
    const none = {} as NodeJS.ProcessEnv;
    expect(isMediaSigningConfigured(none)).toBe(false);
    expect(reason(() => signMediaToken({ tenantKey: "t", assetId: "a" }, none))).toBe("NOT_CONFIGURED");
    expect(reason(() => verifyMediaToken("v1.a.b", { assetId: "a" }, none))).toBe("NOT_CONFIGURED");
    expect(mediaTokenQuery({ tenantKey: "t", assetId: "a" }, none)).toBe("");
  });

  it("ignores a key that is too short (a weak key is the same as no key)", () => {
    expect(isMediaSigningConfigured({ MEDIA_URL_SIGNING_KEY: "short" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("key rotation: the previous key still verifies old tokens, new tokens are signed with the current key, and a removed previous key stops verifying", () => {
    const oldToken = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", nowMs: NOW }, { MEDIA_URL_SIGNING_KEY: OTHER_KEY } as NodeJS.ProcessEnv);
    const rotating = { MEDIA_URL_SIGNING_KEY: KEY, MEDIA_URL_SIGNING_KEY_PREVIOUS: OTHER_KEY } as NodeJS.ProcessEnv;
    expect(verifyMediaToken(oldToken, { assetId: "asset-1", nowMs: NOW }, rotating).tenantKey).toBe("tenant-a");
    const newToken = signMediaToken({ tenantKey: "tenant-a", assetId: "asset-1", nowMs: NOW }, rotating);
    expect(verifyMediaToken(newToken, { assetId: "asset-1", nowMs: NOW }, { MEDIA_URL_SIGNING_KEY: KEY } as NodeJS.ProcessEnv).tenantKey).toBe("tenant-a");
    expect(reason(() => verifyMediaToken(oldToken, { assetId: "asset-1", nowMs: NOW }, ENV))).toBe("BAD_SIGNATURE");
  });

  it("clamps the lifetime: a tiny or huge TTL is bounded, and an invalid TTL setting falls back to the default", () => {
    expect(resolveMediaTokenTtlSeconds({} as NodeJS.ProcessEnv)).toBe(MEDIA_TOKEN_DEFAULT_TTL_SECONDS);
    expect(resolveMediaTokenTtlSeconds({ MEDIA_URL_TTL_SECONDS: "abc" } as NodeJS.ProcessEnv)).toBe(MEDIA_TOKEN_DEFAULT_TTL_SECONDS);
    expect(resolveMediaTokenTtlSeconds({ MEDIA_URL_TTL_SECONDS: "1" } as NodeJS.ProcessEnv)).toBe(MEDIA_TOKEN_DEFAULT_TTL_SECONDS);
    expect(resolveMediaTokenTtlSeconds({ MEDIA_URL_TTL_SECONDS: "99999999999" } as NodeJS.ProcessEnv)).toBe(MEDIA_TOKEN_MAX_TTL_SECONDS);
    const token = signMediaToken({ tenantKey: "t", assetId: "a", ttlSeconds: 999_999_999, nowMs: NOW }, ENV);
    const claims = verifyMediaToken(token, { assetId: "a", nowMs: NOW }, ENV);
    expect(claims.expiresAt - Math.floor(NOW / 1000)).toBe(MEDIA_TOKEN_MAX_TTL_SECONDS);
  });

  it("refuses to sign for a blank tenant or asset", () => {
    expect(reason(() => signMediaToken({ tenantKey: "  ", assetId: "a" }, ENV))).toBe("MALFORMED");
    expect(reason(() => signMediaToken({ tenantKey: "t", assetId: "" }, ENV))).toBe("MALFORMED");
  });

  it("mediaTokenQuery returns a query string that verifies for that asset", () => {
    const query = mediaTokenQuery({ tenantKey: "tenant-b", assetId: "asset-9" }, ENV);
    expect(query.startsWith("?t=v1.")).toBe(true);
    expect(verifyMediaToken(query.slice(3), { assetId: "asset-9" }, ENV).tenantKey).toBe("tenant-b");
  });
});
