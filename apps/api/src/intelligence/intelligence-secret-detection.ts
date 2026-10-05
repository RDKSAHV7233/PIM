// Credential detection for AI payloads (AI-POL-003). Pure and framework-free.
//
// Two modes, because two different jobs were sharing one bare-word regex:
//   FREE_TEXT  product text, model output values, evidence citations, reviewer edits. Explicit credential
//              shapes only, so "Secret Garden Colouring Book" passes and a real credential does not.
//   STRICT     operational identifier fields and notes, where no secret-ish word should ever appear. Bare words.
// JSON key names are checked separately by isSecretLikeKey (intelligence-payload-policy.ts).
//
// Optional detection D6 (a bare long hex digest) is intentionally NOT included: product data may legitimately contain
// hashes, and it needs a production text sample before it can be judged.

export type CredentialDetectorId =
  | "pem_private_key"
  | "authorization_header"
  | "bearer_token"
  | "keyword_assignment"
  | "keyword_space_value"
  | "keyword_prose_value"
  | "token_prefix"
  | "connection_string";

const KEYWORDS = String.raw`passw(?:or)?d|passwd|pwd|secret|client[_ -]?secret|api[_ -]?key|apikey|access[_ -]?key|auth[_ -]?token|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|token|credentials?`;

// Well-known credential prefixes. Connector-relevant formats (Shopify admin tokens, WooCommerce consumer keys) are included.
const TOKEN_PREFIXES = [
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
  String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}`,
  String.raw`\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}`,
  String.raw`\bAIza[0-9A-Za-z_-]{35}`,
  String.raw`\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}`,
  String.raw`\bshp(?:at|ca|pa|ss)_[0-9a-f]{32}\b`,
  String.raw`\b(?:ck|cs)_[0-9a-f]{40}\b`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
].join("|");

const DETECTORS: Array<{ id: CredentialDetectorId; pattern: RegExp }> = [
  { id: "pem_private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "authorization_header", pattern: /\bAuthorization\s*[:=]\s*(?:Bearer|Basic|Digest|Token)\s+\S{6,}/i },
  { id: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i },
  { id: "keyword_assignment", pattern: new RegExp(String.raw`\b(?:${KEYWORDS})\b["']?\s*[:=]\s*["']?[^\s"',;]{4,}`, "i") },
  { id: "keyword_space_value", pattern: new RegExp(String.raw`\b(?:${KEYWORDS})\s+["']?(?=[^\s"',;]*[0-9])[^\s"',;]{4,}`, "i") },
  { id: "keyword_prose_value", pattern: new RegExp(String.raw`\b(?:${KEYWORDS}|passcode)\s+(?:is|was)\s+["']?(?=[^\s"',;]*[0-9_!@#$%^&*])[^\s"',;]{4,}`, "i") },
  { id: "token_prefix", pattern: new RegExp(TOKEN_PREFIXES) },
  { id: "connection_string", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:[^\s@/]+@[^\s/]+/i },
];

/** Which explicit credential shapes the text contains. Never returns the matched text. */
export function detectCredentialShapes(text: string): CredentialDetectorId[] {
  return DETECTORS.filter((detector) => detector.pattern.test(text)).map((detector) => detector.id);
}

/** FREE_TEXT mode. */
export function hasCredentialShape(text: string): boolean {
  return DETECTORS.some((detector) => detector.pattern.test(text));
}

const SECRET_WORD = /\b(api[_ -]?key|bearer\s+|oauth|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|secret|credential|password|token)(?=\b|_)/i;

/** STRICT mode: any secret-ish word. For operational fields where no such word belongs. */
export function hasSecretWord(text: string): boolean {
  return SECRET_WORD.test(text);
}

export type GuardMode = "free_text" | "strict";

export function violatesGuard(text: string, mode: GuardMode): boolean {
  return mode === "strict" ? hasSecretWord(text) : hasCredentialShape(text);
}
