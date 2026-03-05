import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTED_PREFIX = "enc::";
const IV_SIZE_BYTES = 12;
const AUTH_TAG_SIZE_BYTES = 16;

export interface EncryptedCredentialPayload {
  cipher: string;
  keyVersion: number;
}

export function parseCredentialKeyVersion(raw: string | number): number {
  if (typeof raw === "number") {
    if (Number.isInteger(raw) && raw > 0) {
      return raw;
    }
    throw new Error(`Invalid key version: ${raw}`);
  }

  const normalized = raw.trim().toLowerCase();
  const match = /^v?(\d+)$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid key version: ${raw}`);
  }

  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid key version: ${raw}`);
  }
  return value;
}

export function formatCredentialKeyVersion(version: number): string {
  return `v${parseCredentialKeyVersion(version)}`;
}

export function deriveCredentialKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Credential encryption key must not be empty.");
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length === 32) {
        return decoded;
      }
    } catch {
      // Fall through to SHA-256 derivation.
    }
  }

  return createHash("sha256").update(trimmed, "utf8").digest();
}

export function loadCredentialEncryptionKeys(
  env: NodeJS.ProcessEnv = process.env,
): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^CREDENTIAL_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match) {
      continue;
    }
    const raw = String(value ?? "").trim();
    if (!raw) {
      continue;
    }
    const version = Number(match[1]);
    keys.set(version, deriveCredentialKey(raw));
  }
  return keys;
}

export function resolveCurrentCredentialKeyVersion(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = String(env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ?? "1").trim();
  return parseCredentialKeyVersion(raw);
}

export function encryptCredentialValue(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
): string {
  const iv = randomBytes(IV_SIZE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
  return `${ENCRYPTED_PREFIX}${formatCredentialKeyVersion(keyVersion)}:${payload}`;
}

export function decryptCredentialValue(ciphertext: string, key: Buffer): string {
  const normalized = String(ciphertext ?? "").trim();
  const prefixPattern = /^enc::v\d+:(.+)$/;
  const match = prefixPattern.exec(normalized);
  const payload = match ? match[1] : normalized;
  const decoded = Buffer.from(payload, "base64url");
  if (decoded.length <= IV_SIZE_BYTES + AUTH_TAG_SIZE_BYTES) {
    throw new Error("Invalid encrypted credential payload.");
  }

  const iv = decoded.subarray(0, IV_SIZE_BYTES);
  const authTag = decoded.subarray(IV_SIZE_BYTES, IV_SIZE_BYTES + AUTH_TAG_SIZE_BYTES);
  const encryptedBody = decoded.subarray(IV_SIZE_BYTES + AUTH_TAG_SIZE_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encryptedBody), decipher.final()]);
  return plaintext.toString("utf8");
}

export function buildEncryptedCredential(
  plaintext: string,
  currentKeyVersion: number,
  keys: Map<number, Buffer>,
): EncryptedCredentialPayload {
  const version = parseCredentialKeyVersion(currentKeyVersion);
  const key = keys.get(version);
  if (!key) {
    throw new Error(`Missing credential encryption key for version ${version}.`);
  }
  return {
    cipher: encryptCredentialValue(plaintext, key, version),
    keyVersion: version,
  };
}
