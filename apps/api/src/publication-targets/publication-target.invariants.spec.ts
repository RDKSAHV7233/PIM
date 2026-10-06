import * as fs from "node:fs";
import * as path from "node:path";
import {
  PUBLICATION_REASON_CATALOG,
  PUBLICATION_REASON_CODES,
  isPublicationReasonCode,
} from "./publication-target.reason-catalog";
import { PUBLICATION_CONDITION_ORDER, evaluatePublicationTarget, minimumPipelineEvidenceLevel } from "./publication-target.evaluator";
import type { CredentialFact, PublicationTargetInput } from "./publication-target.types";
import { CERTIFICATION_LEVEL_ORDER } from "./publication-target.types";
import { CONTEXT, DAY_MS, HOUR_MS, NOW, pipelineEvidence, readyInput } from "./publication-target.test-fixtures";

const DIR = __dirname;
const SRC = path.resolve(DIR, "..");
const REPO_ROOT = path.resolve(DIR, "..", "..", "..", "..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const isTestFile = (file: string) => /\.spec\.ts$|\.test-fixtures\.ts$/.test(file);

// ── Deterministic generator: a small, adversarial domain for every input field ──────────────────────────────
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

const STAGES = ["live", "early_access", "controlled_pilot", "p1_blocker_hold", "manual", "planned", "po_review", "under_development"] as const;

function randomInput(random: () => number): PublicationTargetInput {
  const fresh = randomFields(random);
  // Half the samples start from the fully-ready baseline and replace each field with probability 12%, so both
  // available and single-fault targets are well represented.
  if (random() < 0.5) return fresh;
  const base = readyInput() as unknown as Record<string, unknown>;
  const mixed: Record<string, unknown> = {};
  for (const key of Object.keys(fresh)) {
    mixed[key] = random() < 0.12 ? (fresh as unknown as Record<string, unknown>)[key] : base[key];
  }
  return mixed as unknown as PublicationTargetInput;
}

function randomFields(random: () => number): PublicationTargetInput {
  const stage = pick(random, STAGES);
  const lastOutcome = pick(random, [null, "VALID", "INVALID", "INDETERMINATE", "CONFIGURATION_ERROR"] as const);
  const credential: CredentialFact | null | undefined = pick(random, [
    undefined,
    null,
    {
      installationStatus: pick(random, ["ACTIVE", "CREDENTIAL_EXPIRED"] as const),
      lastOutcome,
      lastValidAt: pick(random, [null, new Date(NOW.getTime() - HOUR_MS), new Date(NOW.getTime() - 100 * HOUR_MS), new Date("nope")]),
      lastValidProviderVerified: pick(random, [true, false, null] as const),
    },
  ] as const);
  return {
    slug: "acme",
    scope: pick(random, ["tenant", "product"] as const),
    definition: pick(random, [
      undefined,
      null,
      { slug: "acme", displayName: "A", isActive: true, capabilities: ["PUBLISH"] },
      { slug: "acme", displayName: "A", isActive: true, capabilities: ["EXCEL_EXPORT"] },
      { slug: "acme", displayName: "A", isActive: false, capabilities: ["PUBLISH"] },
    ] as const),
    runtimeRegistered: pick(random, [undefined, true, false] as const),
    launchPolicy: pick(random, [
      undefined,
      { launchStage: stage },
      { launchStage: "planned" as const, reason: "CONNECTOR_POLICY_MISSING" as const },
    ] as const),
    evidence: pick(random, [
      undefined,
      [],
      [pipelineEvidence()],
      [pipelineEvidence({ path: "direct_adapter" })],
      [pipelineEvidence({ level: pick(random, CERTIFICATION_LEVEL_ORDER) })],
      [pipelineEvidence({ reverifyBy: pick(random, [null, "2020-01-01", "soon", new Date(NOW.getTime() + DAY_MS).toISOString()] as const) })],
    ] as const),
    commercialSupport: pick(random, [
      undefined,
      null,
      { commerciallySupported: true, approvedBy: "PO", approvalRef: "X" },
      { commerciallySupported: true, approvedBy: "Eng", approvalRef: "X" },
      { commerciallySupported: false, approvedBy: "PO", approvalRef: "X" },
    ] as const),
    tenantEntitlement: pick(random, [
      undefined,
      null,
      { releaseStage: stage, validFrom: new Date(NOW.getTime() - DAY_MS), validUntil: null, revokedAt: null },
      { releaseStage: stage, validFrom: new Date(NOW.getTime() - DAY_MS), validUntil: null, revokedAt: new Date(NOW.getTime() - 1) },
    ] as const),
    targetSchema: pick(random, [undefined, "ready", "missing", "stale"] as const),
    installation: pick(random, [
      undefined,
      null,
      { status: "ACTIVE", authorizationComplete: true },
      { status: "ACTIVE", authorizationComplete: false },
      { status: "DISABLED", authorizationComplete: true },
      { status: "CREDENTIAL_EXPIRED", authorizationComplete: true },
    ] as const),
    credential,
    mapping: pick(random, [undefined, null, { compatibilityState: "compatible" }, { compatibilityState: "deprecated" }, { compatibilityState: "remap_required" }, { compatibilityState: "blocked" }] as const),
    product: pick(random, [undefined, { blockingIssueCount: 0 }, { blockingIssueCount: 2 }, { blockingIssueCount: -1 }] as const),
    priorOutcome: pick(random, [
      undefined,
      { unsettledUnknownOutcome: false, createClassification: "AMBIGUOUS" },
      { unsettledUnknownOutcome: true, createClassification: "AMBIGUOUS" },
      { unsettledUnknownOutcome: true, createClassification: "PROVEN_IDEMPOTENT" },
    ] as const),
  };
}

describe("publication-target invariants (ADR-0015)", () => {
  describe("property checks over 6000 generated inputs", () => {
    const random = lcg(0x51b);
    const samples = Array.from({ length: 6000 }, () => {
      const input = randomInput(random);
      const outcomeSettlementExists = random() < 0.5;
      return { input, result: evaluatePublicationTarget(input, { ...CONTEXT, outcomeSettlementExists }), outcomeSettlementExists };
    });

    it("always returns all twelve conditions in the fixed order", () => {
      for (const { result } of samples) {
        expect(result.conditions.map((entry) => entry.id)).toEqual([...PUBLICATION_CONDITION_ORDER]);
      }
    });

    it("available implies no condition is fail or unknown (and the reverse)", () => {
      for (const { result } of samples) {
        const anyBlocking = result.conditions.some((entry) => entry.status === "fail" || entry.status === "unknown");
        expect(result.available).toBe(!anyBlocking);
        expect(result.blockers).toEqual(result.conditions.filter((entry) => entry.blocking));
      }
    });

    it("every reason code is in the closed catalog", () => {
      for (const { result } of samples) {
        for (const entry of result.conditions) {
          if (entry.code !== null) expect(isPublicationReasonCode(entry.code)).toBe(true);
        }
        for (const code of result.reasonCodes) expect(PUBLICATION_REASON_CODES).toContain(code);
      }
    });

    it("pass and not_applicable carry no code; fail, warn and unknown always carry one", () => {
      for (const { result } of samples) {
        for (const entry of result.conditions) {
          if (entry.status === "pass" || entry.status === "not_applicable") expect(entry.code).toBeNull();
          else expect(entry.code).not.toBeNull();
          if (entry.status === "unknown") expect(entry.code).toBe("EVALUATION_UNAVAILABLE");
        }
      }
    });

    it("an unknown condition makes the target unavailable, never available", () => {
      for (const { result } of samples) {
        if (result.conditions.some((entry) => entry.status === "unknown")) expect(result.available).toBe(false);
      }
    });

    it("only shadow-only conditions can separate availableUnderCurrentEnforcement from available", () => {
      for (const { result, outcomeSettlementExists } of samples) {
        if (result.available) expect(result.availableUnderCurrentEnforcement).toBe(true);
        if (result.availableUnderCurrentEnforcement && !result.available) {
          expect(result.blockers.every((entry) => entry.id === "prior_outcome_settled" && entry.enforcement === "shadow_only")).toBe(true);
          expect(outcomeSettlementExists).toBe(false);
        }
        if (outcomeSettlementExists) expect(result.shadowOnlyReasonCodes).toEqual([]);
      }
    });

    it("capability_verified passes only with current product_pipeline PUBLISH evidence at or above the stage minimum", () => {
      for (const { input, result } of samples) {
        if (result.conditions.find((entry) => entry.id === "capability_verified")?.status !== "pass") continue;
        const minimum = minimumPipelineEvidenceLevel(input.launchPolicy!.launchStage)!;
        expect(minimum).not.toBeNull();
        const ok = (input.evidence ?? []).some(
          (entry) =>
            entry.path === "product_pipeline" &&
            entry.capability === "PUBLISH" &&
            CERTIFICATION_LEVEL_ORDER.indexOf(entry.level) >= CERTIFICATION_LEVEL_ORDER.indexOf(minimum) &&
            typeof entry.reverifyBy === "string" &&
            Date.parse(entry.reverifyBy) > NOW.getTime(),
        );
        expect(ok).toBe(true);
      }
    });

    it("a target whose only evidence is direct_adapter, or whose evidence is expired, is never available", () => {
      for (const { input, result } of samples) {
        const evidence = input.evidence ?? [];
        const hasPipeline = evidence.some((entry) => entry.path === "product_pipeline");
        const hasCurrent = evidence.some((entry) => typeof entry.reverifyBy === "string" && Date.parse(entry.reverifyBy) > NOW.getTime());
        if (input.evidence !== undefined && (!hasPipeline || !hasCurrent)) expect(result.available).toBe(false);
      }
    });

    it("the credential condition passes or warns only for a provider-verified, recent, non-rejected VALID", () => {
      for (const { input, result } of samples) {
        const entry = result.conditions.find((c) => c.id === "credential_acceptable")!;
        if (entry.status !== "pass" && entry.status !== "warn") continue;
        const credential = input.credential!;
        expect(credential.lastValidProviderVerified).toBe(true);
        expect(credential.lastValidAt).not.toBeNull();
        expect(NOW.getTime() - credential.lastValidAt!.getTime()).toBeLessThanOrEqual(CONTEXT.credentialFreshness.windowMs);
        expect(credential.lastOutcome === "VALID" || credential.lastOutcome === "INDETERMINATE").toBe(true);
        expect(credential.installationStatus).not.toBe("CREDENTIAL_EXPIRED");
      }
    });

    it("commercial support passes only with a Product Owner approval reference", () => {
      for (const { input, result } of samples) {
        if (result.conditions.find((c) => c.id === "commercially_supported")?.status !== "pass") continue;
        expect(input.commercialSupport).toMatchObject({ commerciallySupported: true, approvedBy: "PO" });
        expect(String(input.commercialSupport?.approvalRef ?? "").trim().length).toBeGreaterThan(0);
      }
    });

    it("an unknown or missing launch policy, a hold or a non-publishing stage never reaches available", () => {
      for (const { input, result } of samples) {
        const policy = input.launchPolicy;
        const publishable = policy && !policy.reason && ["live", "early_access", "controlled_pilot"].includes(policy.launchStage);
        if (!publishable) expect(result.available).toBe(false);
      }
    });

    it("the generator reaches both outcomes (the properties are not vacuous)", () => {
      expect(samples.filter(({ result }) => result.available).length).toBeGreaterThan(100);
      expect(samples.filter(({ result }) => !result.available).length).toBeGreaterThan(1000);
      expect(samples.some(({ result }) => result.warnings.length > 0)).toBe(true);
      expect(samples.some(({ result }) => result.shadowOnlyReasonCodes.length > 0)).toBe(true);
    });
  });

  describe("closed reason-code catalog", () => {
    it("every code names a condition in the chain (or 'any'), with an owner, a severity and a seller-safe message", () => {
      for (const [code, entry] of Object.entries(PUBLICATION_REASON_CATALOG)) {
        expect(code).toMatch(/^[A-Z0-9_]+$/);
        expect(entry.condition === "any" || (PUBLICATION_CONDITION_ORDER as readonly string[]).includes(entry.condition)).toBe(true);
        expect(["platform", "tenant_admin", "seller"]).toContain(entry.owner);
        expect(["blocking", "warning", "conditional"]).toContain(entry.severity);
        expect(entry.message.length).toBeGreaterThan(10);
        // seller-safe: no provider text, credentials or internals in the message
        expect(entry.message).not.toMatch(/token|secret|password|stack|exception|http\s?\d{3}/i);
      }
    });

    it("only PRIOR_PROVIDER_OUTCOME_UNKNOWN is conditional", () => {
      const conditional = Object.entries(PUBLICATION_REASON_CATALOG)
        .filter(([, entry]) => entry.severity === "conditional")
        .map(([code]) => code);
      expect(conditional).toEqual(["PRIOR_PROVIDER_OUTCOME_UNKNOWN"]);
    });

    it("the catalog and the design document's reason-code table list exactly the same codes", () => {
      const doc = fs.readFileSync(path.join(REPO_ROOT, "docs", "design", "publication-targets-contract.md"), "utf8");
      const section = doc.slice(doc.indexOf("## 3. Reason-code catalog"), doc.indexOf("## 4. Evidence manifest"));
      const documented = [...section.matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((match) => match[1] as string).sort();
      expect(documented.length).toBeGreaterThan(20);
      expect([...PUBLICATION_REASON_CODES].sort()).toEqual(documented);
    });
  });

  describe("structure: no consumers, no side effects, no hardcoded channel list", () => {
    const productionFiles = walk(DIR).filter((file) => !isTestFile(file));

    it("has production files to check", () => {
      expect(productionFiles.length).toBeGreaterThanOrEqual(4);
    });

    it("no code outside this directory imports the publication-targets module yet (zero consumers)", () => {
      // Match the module's directory segment, not unrelated names such as update-publication-targets.dto.
      const resolvesToModule = (specifier: string) => /(^|\/)publication-targets(\/|$)/.test(specifier);
      const offenders = walk(SRC)
        .filter((file) => !file.startsWith(DIR))
        .filter((file) =>
          [...fs.readFileSync(file, "utf8").matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].some((match) => resolvesToModule(match[1] as string)),
        );
      expect(offenders).toEqual([]);
    });

    it("does not use MARKETPLACE_CHANNELS or marketplace-channels as publication authority", () => {
      for (const file of productionFiles) {
        expect(withoutComments(fs.readFileSync(file, "utf8"))).not.toMatch(/MARKETPLACE_CHANNELS|marketplace-channels/);
      }
    });

    it("production files import only each other and the launch-policy / connector-interface types (pure)", () => {
      const allowed = /^(\.\/publication-target\.[a-z-]+|\.\.\/connector-framework\/connector-launch-policy|\.\.\/connector-framework\/connector\.interface)$/;
      for (const file of productionFiles) {
        const imports = [...fs.readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] as string);
        for (const specifier of imports) {
          if (!allowed.test(specifier)) throw new Error(`${path.basename(file)} imports ${specifier}, outside the pure-module allow-list`);
        }
      }
    });

    it("has no I/O, clock, randomness or process access", () => {
      for (const file of productionFiles) {
        const source = withoutComments(fs.readFileSync(file, "utf8"));
        expect(source).not.toMatch(/\bnew Date\(\)|Date\.now\(|Math\.random|process\.|\bfetch\(|require\(|prisma|@nestjs|console\./);
      }
    });
  });
});
