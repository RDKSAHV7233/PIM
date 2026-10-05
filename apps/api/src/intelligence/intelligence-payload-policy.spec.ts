import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isSecretLikeKey,
  isValidPayloadSegment,
  parseRule,
  resolveLeaf,
  validateRulePath,
  wildcardSegments,
  type ParsedPolicyRule,
  type PolicyClassification,
} from "./intelligence-payload-policy";

interface Vectors {
  ruleGrammar: { valid: string[]; invalid: string[] };
  payloadSegments: { valid: string[]; invalid: string[] };
  secretLikeKeys: { secret: string[]; notSecret: string[] };
  resolution: Array<{ id: string; rules: Array<[string, PolicyClassification]>; leaf: string; matched: string[]; effective: PolicyClassification | null }>;
}

const vectors = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "..", "..", "test-fixtures", "ai-policy", "path-semantics.v1.json"), "utf8")) as Vectors;

describe("AI payload policy path semantics (shared conformance vectors)", () => {
  it.each(vectors.ruleGrammar.valid)("accepts rule path %p", (path) => {
    expect(validateRulePath(path)).toBeNull();
    expect(parseRule(path, "AI_ALLOWED")).not.toBeNull();
  });

  it.each(vectors.ruleGrammar.invalid)("rejects rule path %p", (path) => {
    expect(validateRulePath(path)).not.toBeNull();
    expect(parseRule(path, "AI_ALLOWED")).toBeNull();
  });

  it.each(vectors.payloadSegments.valid)("accepts payload segment %p", (segment) => {
    expect(isValidPayloadSegment(segment)).toBe(true);
  });

  it.each(vectors.payloadSegments.invalid)("rejects payload segment %p", (segment) => {
    expect(isValidPayloadSegment(segment)).toBe(false);
  });

  it.each(vectors.secretLikeKeys.secret)("treats key %p as secret-like", (key) => {
    expect(isSecretLikeKey(key)).toBe(true);
  });

  it.each(vectors.secretLikeKeys.notSecret)("does not treat key %p as secret-like", (key) => {
    expect(isSecretLikeKey(key)).toBe(false);
  });

  it.each(vectors.resolution.map((vector) => [vector.id, vector] as const))("resolves %s", (_id, vector) => {
    const rules = vector.rules.map(([path, classification]) => parseRule(path, classification)).filter((rule): rule is ParsedPolicyRule => rule !== null);
    expect(rules).toHaveLength(vector.rules.length);
    const result = resolveLeaf(rules, vector.leaf.split("."));
    expect(result.matched.map((rule) => rule.path)).toEqual(vector.matched);
    expect(result.effective).toBe(vector.effective);
  });

  it("reports which leaf segments a wildcard rule matched", () => {
    const children = parseRule("product.attributes.*", "AI_ALLOWED") as ParsedPolicyRule;
    const subtree = parseRule("product.attributes.**", "AI_ALLOWED") as ParsedPolicyRule;
    const exact = parseRule("product.title", "AI_ALLOWED") as ParsedPolicyRule;
    expect(wildcardSegments(children, ["product", "attributes", "color"])).toEqual(["color"]);
    expect(wildcardSegments(subtree, ["product", "attributes", "a", "b"])).toEqual(["a", "b"]);
    expect(wildcardSegments(exact, ["product", "title"])).toEqual([]);
  });

  it("keeps the vector set itself honest: every rule in it parses and every kind is exercised", () => {
    const kinds = new Set(vectors.resolution.flatMap((vector) => vector.rules.map(([path]) => parseRule(path, "AI_ALLOWED")?.kind)));
    expect(kinds).toEqual(new Set(["exact", "children", "subtree"]));
    expect(new Set(vectors.resolution.map((vector) => vector.id)).size).toBe(vectors.resolution.length);
  });
});
