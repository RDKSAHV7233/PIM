import {
  buildEncryptedCredential,
  decryptCredentialValue,
  deriveCredentialKey,
  encryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from "./credential-encryption.util";

// ---------------------------------------------------------------------------
// parseCredentialKeyVersion
// ---------------------------------------------------------------------------

describe("parseCredentialKeyVersion", () => {
  it.each([
    ["1", 1],
    ["v1", 1],
    ["V2", 2],
    ["v10", 10],
    [1, 1],
    [42, 42],
  ])("parses valid version %p as %d", (input, expected) => {
    expect(parseCredentialKeyVersion(input as never)).toBe(expected);
  });

  it.each(["0", "v0", "-1", "abc", "v1.2", ""])(
    "throws on invalid version string %p",
    (input) => {
      expect(() => parseCredentialKeyVersion(input)).toThrow();
    },
  );

  it.each([0, -1])("throws on non-positive integer %d", (input) => {
    expect(() => parseCredentialKeyVersion(input)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatCredentialKeyVersion
// ---------------------------------------------------------------------------

describe("formatCredentialKeyVersion", () => {
  it("formats version 1 as 'v1'", () => {
    expect(formatCredentialKeyVersion(1)).toBe("v1");
  });

  it("formats version 7 as 'v7'", () => {
    expect(formatCredentialKeyVersion(7)).toBe("v7");
  });

  it("throws for version 0", () => {
    expect(() => formatCredentialKeyVersion(0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// deriveCredentialKey
// ---------------------------------------------------------------------------

describe("deriveCredentialKey", () => {
  it("returns the raw 32-byte buffer for a 64-char hex string", () => {
    const hex = "a".repeat(64);
    const key = deriveCredentialKey(hex);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(hex);
  });

  it("returns a 32-byte buffer for a valid base64-encoded 32-byte key", () => {
    const raw = Buffer.alloc(32, 0xab);
    const b64 = raw.toString("base64");
    const key = deriveCredentialKey(b64);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    expect(key.equals(raw)).toBe(true);
  });

  it("falls back to SHA-256 derivation for an arbitrary passphrase", () => {
    const key = deriveCredentialKey("my-secret-passphrase");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("SHA-256 derivation is deterministic for the same passphrase", () => {
    const key1 = deriveCredentialKey("same-passphrase");
    const key2 = deriveCredentialKey("same-passphrase");
    expect(key1.equals(key2)).toBe(true);
  });

  it("SHA-256 derivation produces different keys for different passphrases", () => {
    const key1 = deriveCredentialKey("pass-a");
    const key2 = deriveCredentialKey("pass-b");
    expect(key1.equals(key2)).toBe(false);
  });

  it("trims whitespace from the passphrase", () => {
    const key1 = deriveCredentialKey("  trimmed  ");
    const key2 = deriveCredentialKey("trimmed");
    expect(key1.equals(key2)).toBe(true);
  });

  it("throws for an empty string", () => {
    expect(() => deriveCredentialKey("")).toThrow();
    expect(() => deriveCredentialKey("   ")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadCredentialEncryptionKeys
// ---------------------------------------------------------------------------

describe("loadCredentialEncryptionKeys", () => {
  it("loads keys from env vars matching CREDENTIAL_ENCRYPTION_KEY_V<N>", () => {
    const env = {
      CREDENTIAL_ENCRYPTION_KEY_V1: "a".repeat(64),
      CREDENTIAL_ENCRYPTION_KEY_V2: "b".repeat(64),
      UNRELATED_VAR: "ignored",
    };
    const keys = loadCredentialEncryptionKeys(env);
    expect(keys.size).toBe(2);
    expect(keys.has(1)).toBe(true);
    expect(keys.has(2)).toBe(true);
    expect(keys.has(3)).toBe(false);
  });

  it("returns an empty map when no matching env vars exist", () => {
    expect(loadCredentialEncryptionKeys({}).size).toBe(0);
  });

  it("skips empty env values", () => {
    const env = { CREDENTIAL_ENCRYPTION_KEY_V1: "" };
    expect(loadCredentialEncryptionKeys(env).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveCurrentCredentialKeyVersion
// ---------------------------------------------------------------------------

describe("resolveCurrentCredentialKeyVersion", () => {
  it("defaults to version 1 when env var is absent", () => {
    expect(resolveCurrentCredentialKeyVersion({})).toBe(1);
  });

  it("parses the value from CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", () => {
    expect(resolveCurrentCredentialKeyVersion({ CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "3" })).toBe(3);
    expect(resolveCurrentCredentialKeyVersion({ CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "v2" })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// encryptCredentialValue / decryptCredentialValue — round-trip
// ---------------------------------------------------------------------------

describe("encrypt/decrypt round-trip", () => {
  const key = deriveCredentialKey("test-key-for-unit-tests");
  const version = 1;

  it("decrypting the encrypted plaintext yields the original", () => {
    const plaintext = "my-api-key-12345";
    const cipher = encryptCredentialValue(plaintext, key, version);
    const decrypted = decryptCredentialValue(cipher, key);
    expect(decrypted).toBe(plaintext);
  });

  it("produces the enc:: prefix and version tag", () => {
    const cipher = encryptCredentialValue("secret", key, version);
    expect(cipher.startsWith("enc::v1:")).toBe(true);
  });

  it("produces a different ciphertext on each call (random IV)", () => {
    const cipher1 = encryptCredentialValue("same-secret", key, version);
    const cipher2 = encryptCredentialValue("same-secret", key, version);
    expect(cipher1).not.toBe(cipher2);
    // But both decrypt to the same plaintext
    expect(decryptCredentialValue(cipher1, key)).toBe("same-secret");
    expect(decryptCredentialValue(cipher2, key)).toBe("same-secret");
  });

  it("decryptCredentialValue accepts payloads without the enc:: prefix", () => {
    // Some callers may strip the prefix before calling decrypt — must still work
    const fullCipher = encryptCredentialValue("raw-ok", key, version);
    const prefixPattern = /^enc::v\d+:(.+)$/;
    const stripped = fullCipher.replace(prefixPattern, "$1");
    expect(decryptCredentialValue(stripped, key)).toBe("raw-ok");
  });

  it("throws when ciphertext is tampered (GCM auth tag check fails)", () => {
    const cipher = encryptCredentialValue("tamper-me", key, version);
    // "enc::v1:" is 8 chars; flip a character in the middle of the payload.
    // Mid-payload characters are never in base64 padding positions so the
    // decoded binary is guaranteed to change, which corrupts the GCM auth tag.
    const prefixLen = "enc::v1:".length;
    const payloadStart = cipher.indexOf(":", prefixLen - 1) + 1;
    const mid = payloadStart + Math.floor((cipher.length - payloadStart) / 2);
    const corrupted = cipher.slice(0, mid) + (cipher[mid] === "A" ? "B" : "A") + cipher.slice(mid + 1);
    expect(() => decryptCredentialValue(corrupted, key)).toThrow();
  });

  it("throws when ciphertext is too short to be valid", () => {
    expect(() => decryptCredentialValue("enc::v1:dG9vc2hvcnQ=", key)).toThrow();
  });

  it("rejects empty string plaintext on decrypt — zero-byte ciphertext fails the min-length guard", () => {
    // encryptCredentialValue("") produces IV(12)+TAG(16)+0 = 28 bytes, which is
    // exactly IV_SIZE+AUTH_TAG_SIZE. The check is `<=` so this is rejected as
    // an invalid (potentially truncated) payload. API credentials must be non-empty.
    const cipher = encryptCredentialValue("", key, version);
    expect(() => decryptCredentialValue(cipher, key)).toThrow("Invalid encrypted credential payload.");
  });

  it("round-trips unicode plaintext", () => {
    const plaintext = "ключ-секрет-🔑";
    const cipher = encryptCredentialValue(plaintext, key, version);
    expect(decryptCredentialValue(cipher, key)).toBe(plaintext);
  });
});

// ---------------------------------------------------------------------------
// buildEncryptedCredential
// ---------------------------------------------------------------------------

describe("buildEncryptedCredential", () => {
  it("returns the correct version and a decryptable cipher", () => {
    const keys = new Map<number, Buffer>([[1, deriveCredentialKey("key-v1")]]);
    const { cipher, keyVersion } = buildEncryptedCredential("secret-value", 1, keys);

    expect(keyVersion).toBe(1);
    expect(cipher.startsWith("enc::v1:")).toBe(true);
    expect(decryptCredentialValue(cipher, keys.get(1)!)).toBe("secret-value");
  });

  it("throws when the version map does not contain the requested version", () => {
    const keys = new Map<number, Buffer>([[1, deriveCredentialKey("key-v1")]]);
    expect(() => buildEncryptedCredential("secret", 2, keys)).toThrow(/Missing credential encryption key/);
  });

  it("uses the correct key when multiple versions are present", () => {
    const keyV1 = deriveCredentialKey("key-v1");
    const keyV2 = deriveCredentialKey("key-v2");
    const keys = new Map<number, Buffer>([[1, keyV1], [2, keyV2]]);

    const { cipher, keyVersion } = buildEncryptedCredential("my-secret", 2, keys);
    expect(keyVersion).toBe(2);
    // Only decryptable with keyV2, not keyV1
    expect(decryptCredentialValue(cipher, keyV2)).toBe("my-secret");
    expect(() => decryptCredentialValue(cipher, keyV1)).toThrow();
  });
});
