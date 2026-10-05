import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectCredentialShapes, hasCredentialShape, hasSecretWord, violatesGuard, type CredentialDetectorId } from "./intelligence-secret-detection";

interface Vectors {
  credentials: Array<{ id: string; detector: CredentialDetectorId; parts: string[] }>;
  innocent: string[];
  mentionsWithoutValue: string[];
  knownResidualFalsePositives: Array<{ id: string; parts: string[] }>;
  knownResidualMisses: Array<{ id: string; parts: string[] }>;
  strictWords: { flagged: string[]; notFlagged: string[] };
}

const vectorsPath = resolve(__dirname, "..", "..", "..", "..", "test-fixtures", "ai-policy", "secret-detection.v1.json");
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as Vectors;
const join = (parts: string[]) => parts.join("");

describe("AI payload secret detection (shared conformance vectors)", () => {
  it.each(vectors.credentials.map((vector) => [vector.id, vector] as const))("detects credential %s", (_id, vector) => {
    const text = join(vector.parts);
    expect(detectCredentialShapes(text)).toContain(vector.detector);
    expect(hasCredentialShape(`Spec sheet note: ${text} end of note`)).toBe(true);
    expect(violatesGuard(text, "free_text")).toBe(true);
  });

  it("covers every detector with at least one credential vector", () => {
    const covered = new Set(vectors.credentials.map((vector) => vector.detector));
    expect(covered).toEqual(new Set(["pem_private_key", "authorization_header", "bearer_token", "keyword_assignment", "keyword_space_value", "keyword_prose_value", "token_prefix", "connection_string"]));
  });

  describe("innocent product text (named list, so a regression to bare-word matching fails by name)", () => {
    it.each(vectors.innocent)("does not flag %p in FREE_TEXT mode", (text) => {
      expect(detectCredentialShapes(text)).toEqual([]);
      expect(violatesGuard(text, "free_text")).toBe(false);
    });

    it("would have been flagged by the old bare-word check, which is the false-positive class this removes", () => {
      expect(vectors.innocent.filter((text) => hasSecretWord(text)).length).toBeGreaterThanOrEqual(20);
    });
  });

  it("does not flag text that only mentions a credential word, but STRICT mode still does", () => {
    for (const text of vectors.mentionsWithoutValue) {
      expect(violatesGuard(text, "free_text")).toBe(false);
    }
    expect(vectors.mentionsWithoutValue.filter((text) => violatesGuard(text, "strict")).length).toBeGreaterThanOrEqual(5);
  });

  it("flags assignment-shaped innocent text on purpose (documented residual false positive)", () => {
    for (const sample of vectors.knownResidualFalsePositives) {
      expect(hasCredentialShape(join(sample.parts))).toBe(true);
    }
  });

  it("documents what FREE_TEXT mode does not catch (residual risk)", () => {
    for (const sample of vectors.knownResidualMisses) {
      expect(hasCredentialShape(join(sample.parts))).toBe(false);
    }
  });

  it("keeps STRICT mode as the bare-word check", () => {
    for (const text of vectors.strictWords.flagged) {
      expect(violatesGuard(text, "strict")).toBe(true);
    }
    for (const text of vectors.strictWords.notFlagged) {
      expect(violatesGuard(text, "strict")).toBe(false);
    }
  });

  it("never returns matched text, only detector ids", () => {
    const text = join(vectors.credentials[0].parts);
    expect(JSON.stringify(detectCredentialShapes(text))).not.toContain(text);
  });

  it("self-check: the vectors file itself contains no contiguous credential shape", () => {
    // If this fails, a credential was committed as a literal, which secret scanning and push protection would reject.
    expect(detectCredentialShapes(readFileSync(vectorsPath, "utf8"))).toEqual([]);
  });
});
