// Explicit path semantics for AI payload classification (AI-POL-002). Pure and framework-free.
//
//   a.b.c     exact leaf
//   a.b.*     direct children of a.b (not a.b itself, not grandchildren)
//   a.b.**    any descendant of a.b (one or more segments below), not a.b itself
//
// A wildcard may only be the last segment. Several rules can match one leaf; any AI_BLOCKED match wins
// ("deny overrides"), then AI_ALLOWED_WITH_REDACTION, then AI_ALLOWED. There are no allow exceptions
// inside a blocked subtree. Rules are never inherited implicitly.

export type PolicyClassification = "AI_ALLOWED" | "AI_ALLOWED_WITH_REDACTION" | "AI_BLOCKED";
export type PolicyRuleKind = "exact" | "children" | "subtree";

export interface ParsedPolicyRule {
  path: string;
  kind: PolicyRuleKind;
  base: string[];
  classification: PolicyClassification;
  redactionEvidenceRequired: boolean;
}

export interface LeafResolution {
  matched: ParsedPolicyRule[];
  /** AI_BLOCKED > AI_ALLOWED_WITH_REDACTION > AI_ALLOWED, or null when no rule matches. */
  effective: PolicyClassification | null;
}

export const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const PRECEDENCE: Record<PolicyClassification, number> = { AI_ALLOWED: 0, AI_ALLOWED_WITH_REDACTION: 1, AI_BLOCKED: 2 };

// Key names are schema-like, so they get a stricter check than free text: separators are dropped before matching so
// camelCase, snake_case and kebab-case compounds (secretKey, client_secret, access-token) are all caught.
const SECRET_LIKE_KEY = /(secret|token|passw(or)?d|credential|apikey|accesskey|privatekey|bearer|oauth|authorization)/;

export function isSecretLikeKey(segment: string): boolean {
  return SECRET_LIKE_KEY.test(segment.toLowerCase().replace(/[_-]/g, ""));
}

export function isValidPayloadSegment(segment: string): boolean {
  return PATH_SEGMENT.test(segment);
}

/** Returns null for a valid rule path, or a short reason for an invalid one. */
export function validateRulePath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) {
    return "rule path is required";
  }
  const segments = path.split(".");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const last = index === segments.length - 1;
    if (segment === "*" || segment === "**") {
      if (!last) {
        return "a wildcard is only allowed as the last segment";
      }
      if (segments.length === 1) {
        return "a wildcard needs a parent path";
      }
      continue;
    }
    if (!PATH_SEGMENT.test(segment)) {
      return "segments may only contain letters, digits, underscore and hyphen";
    }
  }
  return null;
}

export function parseRule(path: string, classification: PolicyClassification, redactionEvidenceRequired = false): ParsedPolicyRule | null {
  if (validateRulePath(path) !== null) {
    return null;
  }
  const segments = path.split(".");
  const tail = segments[segments.length - 1];
  const kind: PolicyRuleKind = tail === "**" ? "subtree" : tail === "*" ? "children" : "exact";
  return { path, kind, base: kind === "exact" ? segments : segments.slice(0, -1), classification, redactionEvidenceRequired };
}

export function ruleMatches(rule: ParsedPolicyRule, leaf: string[]): boolean {
  const { base } = rule;
  if (rule.kind === "exact") {
    return leaf.length === base.length && base.every((segment, index) => segment === leaf[index]);
  }
  if (!base.every((segment, index) => segment === leaf[index])) {
    return false;
  }
  return rule.kind === "children" ? leaf.length === base.length + 1 : leaf.length > base.length;
}

export function resolveLeaf(rules: ParsedPolicyRule[], leaf: string[]): LeafResolution {
  const matched = rules.filter((rule) => ruleMatches(rule, leaf));
  if (matched.length === 0) {
    return { matched, effective: null };
  }
  const effective = matched.reduce<PolicyClassification>(
    (winner, rule) => (PRECEDENCE[rule.classification] > PRECEDENCE[winner] ? rule.classification : winner),
    "AI_ALLOWED",
  );
  return { matched, effective };
}

/** Segments of the leaf that a wildcard rule matched, which is where unseen key names can appear. */
export function wildcardSegments(rule: ParsedPolicyRule, leaf: string[]): string[] {
  return rule.kind === "exact" ? [] : leaf.slice(rule.base.length);
}
