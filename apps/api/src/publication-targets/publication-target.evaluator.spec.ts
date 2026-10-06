import { CONNECTOR_SLUGS } from "../connector-framework/connector.constants";
import { resolveConnectorLaunchPolicy, type ConnectorLaunchStage } from "../connector-framework/connector-launch-policy";
import {
  PUBLICATION_CONDITION_ORDER,
  evaluatePublicationTarget,
  isCredentialFreshnessPolicySupportable,
  minimumPipelineEvidenceLevel,
  requiredCredentialFreshnessWindowMs,
} from "./publication-target.evaluator";
import type { PublicationConditionId, PublicationReasonCode } from "./publication-target.reason-catalog";
import type { CredentialFact, PublicationTargetInput } from "./publication-target.types";
import { CONTEXT, DAY_MS, HOUR_MS, NOW, condition, evaluate, pipelineEvidence, readyInput } from "./publication-target.test-fixtures";

describe("evaluatePublicationTarget", () => {
  describe("baseline", () => {
    it("is available only when all twelve conditions pass, reported in the fixed chain order", () => {
      const result = evaluate();
      expect(result.available).toBe(true);
      expect(result.blockers).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.reasonCodes).toEqual([]);
      expect(result.conditions.map((entry) => entry.id)).toEqual([...PUBLICATION_CONDITION_ORDER]);
      expect(result.conditions.every((entry) => entry.status === "pass")).toBe(true);
      expect(result.evaluatedAt).toBe(NOW.toISOString());
      expect(result.key).toBe("acme");
    });

    it("in tenant scope the product conditions are not_applicable and the target can still be available", () => {
      const result = evaluate({ scope: "tenant", product: undefined, priorOutcome: undefined });
      expect(condition(result, "product_ready").status).toBe("not_applicable");
      expect(condition(result, "prior_outcome_settled").status).toBe("not_applicable");
      expect(result.available).toBe(true);
    });

    it("does not mutate its input", () => {
      const input = readyInput();
      const snapshot = JSON.stringify(input);
      evaluatePublicationTarget(input, CONTEXT);
      expect(JSON.stringify(input)).toBe(snapshot);
    });

    it("normalizes the slug in the result key", () => {
      expect(evaluate({ slug: "  ACME " }).key).toBe("acme");
    });
  });

  // ── I1..I6: each state is separate and individually reported ──────────────────────────────────────────────
  describe("states are never collapsed", () => {
    it("I1 a definition that exists is not a registered runtime", () => {
      const result = evaluate({ runtimeRegistered: false });
      expect(condition(result, "definition_exists").status).toBe("pass");
      expect(condition(result, "runtime_registered").code).toBe("CONNECTOR_NOT_REGISTERED");
      expect(result.available).toBe(false);
    });

    it("I1 a registered runtime without a definition row is not a target", () => {
      const result = evaluate({ definition: null });
      expect(condition(result, "runtime_registered").status).toBe("pass");
      expect(condition(result, "definition_exists").code).toBe("CONNECTOR_NOT_DEFINED");
      expect(condition(result, "publish_declared").status).toBe("not_applicable");
      expect(result.available).toBe(false);
    });

    it("an inactive definition is not a defined target", () => {
      const result = evaluate({ definition: { slug: "acme", displayName: "Acme", isActive: false, capabilities: ["PUBLISH"] } });
      expect(condition(result, "definition_exists").code).toBe("CONNECTOR_NOT_DEFINED");
      expect(result.available).toBe(false);
    });

    it("I2 a registered runtime is not a declared PUBLISH capability", () => {
      const result = evaluate({ definition: { slug: "acme", displayName: "Acme", isActive: true, capabilities: ["VALIDATE", "EXCEL_EXPORT"] } });
      expect(condition(result, "runtime_registered").status).toBe("pass");
      expect(condition(result, "publish_declared").code).toBe("PUBLISH_NOT_DECLARED");
      expect(condition(result, "capability_verified").status).toBe("not_applicable");
      expect(result.available).toBe(false);
    });

    it("I3 a declared PUBLISH capability is not verified pipeline evidence", () => {
      const result = evaluate({ evidence: [] });
      expect(condition(result, "publish_declared").status).toBe("pass");
      expect(condition(result, "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
      expect(result.available).toBe(false);
    });

    it("I4 verified evidence is not release allowed", () => {
      const result = evaluate({ launchPolicy: { launchStage: "p1_blocker_hold" } });
      expect(condition(result, "release_allowed").code).toBe("P1_BLOCKER_HOLD");
      expect(result.available).toBe(false);
    });

    it("I5 release allowed is not commercially supported", () => {
      const result = evaluate({ commercialSupport: { commerciallySupported: false, approvedBy: null, approvalRef: null } });
      expect(condition(result, "release_allowed").status).toBe("pass");
      expect(condition(result, "commercially_supported").code).toBe("NOT_COMMERCIALLY_SUPPORTED");
      expect(result.available).toBe(false);
    });

    it("I6 commercial support is not installation, credential, mapping or product readiness", () => {
      const cases: Array<[Partial<PublicationTargetInput>, PublicationConditionId, PublicationReasonCode]> = [
        [{ installation: null }, "installation_eligible", "NO_INSTALLATION"],
        [{ mapping: { compatibilityState: "blocked" } }, "mapping_ready", "MAPPING_NOT_READY"],
        [{ product: { blockingIssueCount: 2 } }, "product_ready", "PRODUCT_NOT_READY"],
      ];
      for (const [override, id, code] of cases) {
        const result = evaluate(override);
        expect(condition(result, "commercially_supported").status).toBe("pass");
        expect(condition(result, id).code).toBe(code);
        expect(result.available).toBe(false);
      }
    });
  });

  // ── I7: every required condition must pass ────────────────────────────────────────────────────────────────
  describe("I7 every required condition must pass", () => {
    const BREAKERS: Array<[PublicationConditionId, PublicationReasonCode, Partial<PublicationTargetInput>]> = [
      ["definition_exists", "CONNECTOR_NOT_DEFINED", { definition: null }],
      ["runtime_registered", "CONNECTOR_NOT_REGISTERED", { runtimeRegistered: false }],
      ["publish_declared", "PUBLISH_NOT_DECLARED", { definition: { slug: "acme", displayName: "A", isActive: true, capabilities: ["VALIDATE"] } }],
      ["capability_verified", "CAPABILITY_NOT_VERIFIED", { evidence: [] }],
      ["release_allowed", "LAUNCH_STAGE_NOT_PUBLISHABLE", { launchPolicy: { launchStage: "po_review" } }],
      ["commercially_supported", "NOT_COMMERCIALLY_SUPPORTED", { commercialSupport: null }],
      ["target_schema_ready", "TARGET_SCHEMA_MISSING", { targetSchema: "missing" }],
      ["installation_eligible", "INSTALLATION_NOT_ACTIVE", { installation: { status: "DISABLED", authorizationComplete: true } }],
      ["credential_acceptable", "CREDENTIAL_INVALID", { credential: { ...readyInput().credential!, lastOutcome: "INVALID" } }],
      ["mapping_ready", "MAPPING_NOT_READY", { mapping: null }],
      ["product_ready", "PRODUCT_NOT_READY", { product: { blockingIssueCount: 1 } }],
      ["prior_outcome_settled", "PRIOR_PROVIDER_OUTCOME_UNKNOWN", { priorOutcome: { unsettledUnknownOutcome: true, createClassification: "AMBIGUOUS" } }],
    ];

    it("covers every condition in the chain", () => {
      expect(BREAKERS.map(([id]) => id)).toEqual([...PUBLICATION_CONDITION_ORDER]);
    });

    it.each(BREAKERS)("breaking only %s makes the target unavailable with %s and nothing else", (id, code, override) => {
      const result = evaluate(override);
      expect(result.available).toBe(false);
      expect(condition(result, id).code).toBe(code);
      expect(result.reasonCodes).toEqual([code]);
    });
  });

  // ── Fail closed ───────────────────────────────────────────────────────────────────────────────────────────
  describe("fail closed", () => {
    const FIELDS: Array<[keyof PublicationTargetInput, PublicationConditionId, Partial<PublicationTargetInput>]> = [
      ["definition", "definition_exists", {}],
      ["runtimeRegistered", "runtime_registered", {}],
      ["launchPolicy", "release_allowed", {}],
      ["evidence", "capability_verified", {}],
      ["commercialSupport", "commercially_supported", {}],
      ["targetSchema", "target_schema_ready", {}],
      ["installation", "installation_eligible", {}],
      ["credential", "credential_acceptable", {}],
      ["mapping", "mapping_ready", {}],
      ["product", "product_ready", {}],
      ["priorOutcome", "prior_outcome_settled", {}],
      ["tenantEntitlement", "release_allowed", { launchPolicy: { launchStage: "early_access" } }],
    ];

    it.each(FIELDS)("an unsupplied %s is unknown on %s, never assumed true", (field, id, extra) => {
      const result = evaluate({ ...extra, [field]: undefined } as Partial<PublicationTargetInput>);
      expect(condition(result, id).status).toBe("unknown");
      expect(condition(result, id).code).toBe("EVALUATION_UNAVAILABLE");
      expect(result.available).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
    });

    it("a condition whose inputs throw is unknown, not pass and not omitted", () => {
      const poisoned = [
        {
          get connector(): string {
            throw new Error("boom");
          },
          capability: "PUBLISH",
          path: "product_pipeline",
          level: "certified",
        },
      ] as unknown as PublicationTargetInput["evidence"];
      const result = evaluate({ evidence: poisoned });
      expect(condition(result, "capability_verified").status).toBe("unknown");
      expect(result.conditions).toHaveLength(12);
      expect(result.available).toBe(false);
    });

    it("missing policy: CONNECTOR_POLICY_MISSING, from the real launch policy for a never-seen slug", () => {
      const policy = resolveConnectorLaunchPolicy("never-seen-before-connector", ["PUBLISH"]);
      const result = evaluate({ launchPolicy: { launchStage: policy.launchStage, reason: policy.reason } });
      expect(condition(result, "release_allowed").code).toBe("CONNECTOR_POLICY_MISSING");
      expect(result.available).toBe(false);
    });
  });

  // ── Evidence ──────────────────────────────────────────────────────────────────────────────────────────────
  describe("capability evidence", () => {
    it("missing evidence is unavailable", () => {
      expect(condition(evaluate({ evidence: [] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
    });

    it("direct-adapter evidence never counts, however high its level", () => {
      const result = evaluate({ evidence: [pipelineEvidence({ path: "direct_adapter", level: "certified" })] });
      expect(condition(result, "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
      expect(result.available).toBe(false);
    });

    it("evidence for a different capability or connector does not count", () => {
      expect(condition(evaluate({ evidence: [pipelineEvidence({ capability: "VALIDATE" })] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
      expect(condition(evaluate({ evidence: [pipelineEvidence({ connector: "someone-else" })] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
    });

    it("an untested entry is untested", () => {
      expect(condition(evaluate({ evidence: [pipelineEvidence({ level: "untested" })] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
    });

    it("an unrecognized level never meets any minimum", () => {
      const level = "excellent" as never;
      expect(condition(evaluate({ evidence: [pipelineEvidence({ level })] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
    });

    it("minimum level by stage: live certified, early_access production_verified, controlled_pilot sandbox_verified", () => {
      expect(minimumPipelineEvidenceLevel("live")).toBe("certified");
      expect(minimumPipelineEvidenceLevel("early_access")).toBe("production_verified");
      expect(minimumPipelineEvidenceLevel("controlled_pilot")).toBe("sandbox_verified");
      for (const stage of ["manual", "p1_blocker_hold", "planned", "po_review", "deprecated"] as ConnectorLaunchStage[]) {
        expect(minimumPipelineEvidenceLevel(stage)).toBeNull();
      }
    });

    it("live needs certified: production_verified is not enough", () => {
      const result = evaluate({ evidence: [pipelineEvidence({ level: "production_verified" })] });
      expect(condition(result, "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
    });

    it("early_access needs production_verified: sandbox_verified is not enough, production_verified passes", () => {
      const entitlement = { releaseStage: "early_access" as const, validFrom: new Date(NOW.getTime() - DAY_MS), validUntil: null, revokedAt: null };
      const base = { launchPolicy: { launchStage: "early_access" as const }, tenantEntitlement: entitlement };
      expect(condition(evaluate({ ...base, evidence: [pipelineEvidence({ level: "sandbox_verified" })] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
      expect(evaluate({ ...base, evidence: [pipelineEvidence({ level: "production_verified" })] }).available).toBe(true);
    });

    it("controlled_pilot accepts sandbox_verified", () => {
      const entitlement = { releaseStage: "controlled_pilot" as const, validFrom: new Date(NOW.getTime() - DAY_MS), validUntil: null, revokedAt: null };
      const result = evaluate({
        launchPolicy: { launchStage: "controlled_pilot" },
        tenantEntitlement: entitlement,
        evidence: [pipelineEvidence({ level: "sandbox_verified" })],
      });
      expect(result.available).toBe(true);
    });

    describe("expiry (reverifyBy is authoritative)", () => {
      it("evidence past reverifyBy is RECERTIFICATION_REQUIRED, never pass", () => {
        const result = evaluate({ evidence: [pipelineEvidence({ reverifyBy: new Date(NOW.getTime() - 1).toISOString() })] });
        expect(condition(result, "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
        expect(condition(result, "capability_verified").status).toBe("fail");
        expect(result.available).toBe(false);
      });

      it("evidence expiring exactly now is expired", () => {
        const result = evaluate({ evidence: [pipelineEvidence({ reverifyBy: NOW.toISOString() })] });
        expect(condition(result, "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
      });

      it("verified evidence with no reverifyBy needs recertification (no date means not currently attested)", () => {
        expect(condition(evaluate({ evidence: [pipelineEvidence({ reverifyBy: null })] }), "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
      });

      it("evidence dated in the future, or undated, is not current", () => {
        const future = new Date(NOW.getTime() + DAY_MS).toISOString();
        expect(condition(evaluate({ evidence: [pipelineEvidence({ verifiedAt: future })] }), "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
        expect(condition(evaluate({ evidence: [pipelineEvidence({ verifiedAt: null })] }), "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
        expect(condition(evaluate({ evidence: [pipelineEvidence({ verifiedAt: "sometime" })] }), "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
      });

      it("an unparseable reverifyBy needs recertification", () => {
        expect(condition(evaluate({ evidence: [pipelineEvidence({ reverifyBy: "soon" })] }), "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
      });

      it("a second, current entry that meets the minimum keeps the capability verified", () => {
        const result = evaluate({
          evidence: [pipelineEvidence({ reverifyBy: "2026-01-01", evidenceRef: "old" }), pipelineEvidence({ evidenceRef: "new" })],
        });
        expect(condition(result, "capability_verified").status).toBe("pass");
        expect(condition(result, "capability_verified").evidenceRef).toBe("new");
      });

      it("expired evidence above the minimum is RECERTIFICATION_REQUIRED, while expired evidence below it is just not verified", () => {
        const expired = new Date(NOW.getTime() - DAY_MS).toISOString();
        expect(condition(evaluate({ evidence: [pipelineEvidence({ reverifyBy: expired })] }), "capability_verified").code).toBe("RECERTIFICATION_REQUIRED");
        expect(condition(evaluate({ evidence: [pipelineEvidence({ level: "unit_tested", reverifyBy: expired })] }), "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
      });
    });
  });

  // ── Release ───────────────────────────────────────────────────────────────────────────────────────────────
  describe("release allowed", () => {
    it("p1_blocker_hold fails with P1_BLOCKER_HOLD", () => {
      expect(condition(evaluate({ launchPolicy: { launchStage: "p1_blocker_hold" } }), "release_allowed").code).toBe("P1_BLOCKER_HOLD");
    });

    it.each(["planned", "under_development", "code_complete", "qa_validation", "po_review", "manual", "deprecated", "internal_diagnostic"] as ConnectorLaunchStage[])(
      "%s is not publishable",
      (stage) => {
        expect(condition(evaluate({ launchPolicy: { launchStage: stage } }), "release_allowed").code).toBe("LAUNCH_STAGE_NOT_PUBLISHABLE");
      },
    );

    describe("cohort stages need an active tenant entitlement", () => {
      const stage = "early_access" as const;
      const entitlement = (over: Record<string, unknown> = {}) => ({
        releaseStage: stage,
        validFrom: new Date(NOW.getTime() - DAY_MS),
        validUntil: null,
        revokedAt: null,
        ...over,
      });
      const run = (tenantEntitlement: PublicationTargetInput["tenantEntitlement"]) =>
        condition(
          evaluate({ launchPolicy: { launchStage: stage }, tenantEntitlement, evidence: [pipelineEvidence({ level: "production_verified" })] }),
          "release_allowed",
        );

      it("no entitlement is RELEASE_RESTRICTED", () => expect(run(null).code).toBe("RELEASE_RESTRICTED"));
      it("an active entitlement passes", () => expect(run(entitlement()).status).toBe("pass"));
      it("an entitlement for a different stage does not count", () => expect(run(entitlement({ releaseStage: "controlled_pilot" })).code).toBe("RELEASE_RESTRICTED"));
      it("a revoked entitlement does not count", () => expect(run(entitlement({ revokedAt: new Date(NOW.getTime() - 1) })).code).toBe("RELEASE_RESTRICTED"));
      it("an expired entitlement does not count", () => expect(run(entitlement({ validUntil: new Date(NOW.getTime() - 1) })).code).toBe("RELEASE_RESTRICTED"));
      it("an entitlement that has not started does not count", () => expect(run(entitlement({ validFrom: new Date(NOW.getTime() + 1) })).code).toBe("RELEASE_RESTRICTED"));
      it("an entitlement with an invalid date does not count", () => expect(run(entitlement({ validFrom: new Date("nope") })).code).toBe("RELEASE_RESTRICTED"));
    });

    it("live has no cohort restriction", () => {
      expect(condition(evaluate({ tenantEntitlement: null }), "release_allowed").status).toBe("pass");
    });
  });

  // ── Commercial support ────────────────────────────────────────────────────────────────────────────────────
  describe("commercial support (Product Owner accountable, default false)", () => {
    it.each([
      ["no record", null],
      ["false", { commerciallySupported: false, approvedBy: "PO", approvalRef: "X" }],
      ["not approved by the Product Owner", { commerciallySupported: true, approvedBy: "Engineering", approvalRef: "X" }],
      ["no approval reference", { commerciallySupported: true, approvedBy: "PO", approvalRef: null }],
      ["a blank approval reference", { commerciallySupported: true, approvedBy: "PO", approvalRef: "   " }],
    ])("%s is not commercially supported", (_label, commercialSupport) => {
      expect(condition(evaluate({ commercialSupport }), "commercially_supported").code).toBe("NOT_COMMERCIALLY_SUPPORTED");
    });
  });

  // ── Target schema, installation, mapping, product ─────────────────────────────────────────────────────────
  describe("target schema", () => {
    it("missing and stale fail with their own codes", () => {
      expect(condition(evaluate({ targetSchema: "missing" }), "target_schema_ready").code).toBe("TARGET_SCHEMA_MISSING");
      expect(condition(evaluate({ targetSchema: "stale" }), "target_schema_ready").code).toBe("TARGET_SCHEMA_STALE");
    });
    it("an unrecognized state is unknown", () => {
      expect(condition(evaluate({ targetSchema: "fresh" as never }), "target_schema_ready").status).toBe("unknown");
    });
  });

  describe("installation", () => {
    it("no installation, an inactive one and incomplete authorization each fail with their own code", () => {
      expect(condition(evaluate({ installation: null }), "installation_eligible").code).toBe("NO_INSTALLATION");
      expect(condition(evaluate({ installation: { status: "DISABLED", authorizationComplete: true } }), "installation_eligible").code).toBe("INSTALLATION_NOT_ACTIVE");
      expect(condition(evaluate({ installation: { status: "ACTIVE", authorizationComplete: false } }), "installation_eligible").code).toBe("INSTALLATION_AUTH_INCOMPLETE");
    });

    it("the credential condition is not evaluated when there is no eligible installation", () => {
      const result = evaluate({ installation: null });
      expect(condition(result, "credential_acceptable").status).toBe("not_applicable");
      expect(condition(result, "credential_acceptable").message).toMatch(/BLOCKED_BY_EARLIER_CONDITION/);
    });

    it("CREDENTIAL_EXPIRED is reported once, as CREDENTIAL_INVALID, not as an inactive installation", () => {
      const result = evaluate({
        installation: { status: "CREDENTIAL_EXPIRED", authorizationComplete: true },
        credential: { ...readyInput().credential!, installationStatus: "CREDENTIAL_EXPIRED", lastOutcome: "INVALID" },
      });
      expect(condition(result, "installation_eligible").status).toBe("pass");
      expect(result.reasonCodes).toEqual(["CREDENTIAL_INVALID"]);
    });
  });

  describe("mapping", () => {
    it("compatible passes; deprecated warns and stays available; remap_required and blocked block; no mapping blocks", () => {
      expect(condition(evaluate({ mapping: { compatibilityState: "compatible" } }), "mapping_ready").status).toBe("pass");
      const deprecated = evaluate({ mapping: { compatibilityState: "deprecated" } });
      expect(condition(deprecated, "mapping_ready").code).toBe("MAPPING_DEPRECATED");
      expect(condition(deprecated, "mapping_ready").status).toBe("warn");
      expect(deprecated.available).toBe(true);
      expect(deprecated.warnings).toHaveLength(1);
      for (const state of ["remap_required", "blocked"] as const) {
        const result = evaluate({ mapping: { compatibilityState: state } });
        expect(condition(result, "mapping_ready").code).toBe("MAPPING_NOT_READY");
        expect(result.available).toBe(false);
      }
      expect(condition(evaluate({ mapping: null }), "mapping_ready").code).toBe("MAPPING_NOT_READY");
      expect(condition(evaluate({ mapping: { compatibilityState: "retired" as never } }), "mapping_ready").status).toBe("unknown");
    });
  });

  describe("product readiness", () => {
    it("blocking issues fail; an invalid count is unknown", () => {
      expect(condition(evaluate({ product: { blockingIssueCount: 3 } }), "product_ready").code).toBe("PRODUCT_NOT_READY");
      expect(condition(evaluate({ product: { blockingIssueCount: -1 } }), "product_ready").status).toBe("unknown");
      expect(condition(evaluate({ product: { blockingIssueCount: Number.NaN } }), "product_ready").status).toBe("unknown");
    });
  });

  // ── Credentials ───────────────────────────────────────────────────────────────────────────────────────────
  describe("credentials (last trustworthy state)", () => {
    const credential = (over: Partial<CredentialFact> = {}): CredentialFact => ({ ...readyInput().credential!, ...over });
    const run = (over: Partial<CredentialFact> | null) => evaluate({ credential: over === null ? null : credential(over) });
    const code = (result: ReturnType<typeof evaluate>) => condition(result, "credential_acceptable");

    it("VALID and provider-authenticated is eligible", () => {
      expect(code(run({})).status).toBe("pass");
    });

    it("VALID with TOKEN_ONLY (not provider-verified) is CREDENTIAL_NOT_PROVIDER_VERIFIED", () => {
      const result = run({ lastValidProviderVerified: false });
      expect(code(result).code).toBe("CREDENTIAL_NOT_PROVIDER_VERIFIED");
      expect(result.available).toBe(false);
    });

    it("provider verification that is not known counts as not verified", () => {
      expect(code(run({ lastValidProviderVerified: null })).code).toBe("CREDENTIAL_NOT_PROVIDER_VERIFIED");
    });

    it("recent VALID followed by INDETERMINATE is a warning, and the target stays available", () => {
      const result = run({ lastOutcome: "INDETERMINATE", lastValidAt: new Date(NOW.getTime() - 6 * HOUR_MS) });
      expect(code(result).status).toBe("warn");
      expect(code(result).code).toBe("CREDENTIAL_CHECK_INCONCLUSIVE");
      expect(result.available).toBe(true);
      expect(result.warnings.map((entry) => entry.code)).toEqual(["CREDENTIAL_CHECK_INCONCLUSIVE"]);
    });

    it("never validated is a blocker, with no credential facts, no VALID ever, or only INDETERMINATE", () => {
      expect(code(run(null)).code).toBe("CREDENTIAL_NEVER_VALIDATED");
      expect(code(run({ lastOutcome: null, lastValidAt: null, lastValidProviderVerified: null })).code).toBe("CREDENTIAL_NEVER_VALIDATED");
      expect(code(run({ lastOutcome: "INDETERMINATE", lastValidAt: null, lastValidProviderVerified: null })).code).toBe("CREDENTIAL_NEVER_VALIDATED");
    });

    it("a lastValidAt that disagrees with a missing outcome is not trusted", () => {
      expect(code(run({ lastOutcome: null })).code).toBe("CREDENTIAL_NEVER_VALIDATED");
    });

    it("a stale VALID is CREDENTIAL_STALE, also when the latest attempt was INDETERMINATE", () => {
      const stale = new Date(NOW.getTime() - 73 * HOUR_MS);
      expect(code(run({ lastValidAt: stale })).code).toBe("CREDENTIAL_STALE");
      expect(code(run({ lastValidAt: stale, lastOutcome: "INDETERMINATE" })).code).toBe("CREDENTIAL_STALE");
    });

    it("the freshness boundary: exactly the window is fresh, one millisecond past is stale", () => {
      expect(code(run({ lastValidAt: new Date(NOW.getTime() - 72 * HOUR_MS) })).status).toBe("pass");
      expect(code(run({ lastValidAt: new Date(NOW.getTime() - 72 * HOUR_MS - 1) })).code).toBe("CREDENTIAL_STALE");
    });

    it("INVALID and CREDENTIAL_EXPIRED are blockers", () => {
      expect(code(run({ lastOutcome: "INVALID" })).code).toBe("CREDENTIAL_INVALID");
      expect(code(run({ installationStatus: "CREDENTIAL_EXPIRED" })).code).toBe("CREDENTIAL_INVALID");
    });

    it("CONFIGURATION_ERROR is a blocker", () => {
      expect(code(run({ lastOutcome: "CONFIGURATION_ERROR" })).code).toBe("CREDENTIAL_CONFIGURATION_ERROR");
    });

    it("an invalid lastValidAt date is unknown", () => {
      expect(code(run({ lastValidAt: new Date("nope") })).status).toBe("unknown");
    });

    describe("freshness policy", () => {
      it("the window must be at least 2 x heartbeatMaxRotation + one scheduler interval", () => {
        const policy = { windowMs: 30 * HOUR_MS, heartbeatMaxRotationMs: 12 * HOUR_MS, schedulerIntervalMs: 6 * HOUR_MS };
        expect(requiredCredentialFreshnessWindowMs(policy)).toBe(30 * HOUR_MS);
        expect(isCredentialFreshnessPolicySupportable(policy)).toBe(true);
        expect(isCredentialFreshnessPolicySupportable({ ...policy, windowMs: 30 * HOUR_MS - 1 })).toBe(false);
        expect(isCredentialFreshnessPolicySupportable({ ...policy, heartbeatMaxRotationMs: 0 })).toBe(false);
        expect(isCredentialFreshnessPolicySupportable({ ...policy, windowMs: Number.NaN })).toBe(false);
      });

      it("an unsupportable window is an evaluation failure, not 'stale'", () => {
        const result = evaluate({}, { credentialFreshness: { windowMs: 10 * HOUR_MS, heartbeatMaxRotationMs: 12 * HOUR_MS, schedulerIntervalMs: 6 * HOUR_MS } });
        expect(code(result).status).toBe("unknown");
        expect(code(result).code).toBe("EVALUATION_UNAVAILABLE");
        expect(result.available).toBe(false);
      });

      it("an unsupportable window does not hide an explicit rejection", () => {
        const result = evaluate(
          { credential: credential({ lastOutcome: "INVALID" }) },
          { credentialFreshness: { windowMs: 1, heartbeatMaxRotationMs: 12 * HOUR_MS, schedulerIntervalMs: 6 * HOUR_MS } },
        );
        expect(code(result).code).toBe("CREDENTIAL_INVALID");
      });
    });
  });

  // ── Prior provider outcome: reported, not enforced, until settlement exists ───────────────────────────────
  describe("prior provider outcome", () => {
    const unsettled = (createClassification: "AMBIGUOUS" | "PROVEN_IDEMPOTENT" | "PROVEN_RECONCILABLE") => ({
      unsettledUnknownOutcome: true,
      createClassification,
    });

    it("an unsettled unknown outcome on an AMBIGUOUS create blocks the full contract but is shadow-only today", () => {
      const result = evaluate({ priorOutcome: unsettled("AMBIGUOUS") });
      expect(condition(result, "prior_outcome_settled").code).toBe("PRIOR_PROVIDER_OUTCOME_UNKNOWN");
      expect(condition(result, "prior_outcome_settled").enforcement).toBe("shadow_only");
      expect(result.available).toBe(false);
      expect(result.availableUnderCurrentEnforcement).toBe(true);
      expect(result.shadowOnlyReasonCodes).toEqual(["PRIOR_PROVIDER_OUTCOME_UNKNOWN"]);
    });

    it("once settlement exists the same condition is enforced", () => {
      const result = evaluate({ priorOutcome: unsettled("AMBIGUOUS") }, { outcomeSettlementExists: true });
      expect(condition(result, "prior_outcome_settled").enforcement).toBe("enforced");
      expect(result.availableUnderCurrentEnforcement).toBe(false);
      expect(result.shadowOnlyReasonCodes).toEqual([]);
    });

    it("an idempotent or reconciliation-safe create only warns and does not block", () => {
      for (const classification of ["PROVEN_IDEMPOTENT", "PROVEN_RECONCILABLE"] as const) {
        const result = evaluate({ priorOutcome: unsettled(classification) });
        expect(condition(result, "prior_outcome_settled").status).toBe("warn");
        expect(result.available).toBe(true);
      }
    });

    it("an unrecognized classification is treated as AMBIGUOUS", () => {
      const result = evaluate({ priorOutcome: { unsettledUnknownOutcome: true, createClassification: "UNSURE" as never } });
      expect(condition(result, "prior_outcome_settled").status).toBe("fail");
    });

    it("a shadow-only block does not hide an enforced blocker", () => {
      const result = evaluate({ priorOutcome: unsettled("AMBIGUOUS"), mapping: null });
      expect(result.availableUnderCurrentEnforcement).toBe(false);
      expect(result.reasonCodes).toEqual(["MAPPING_NOT_READY", "PRIOR_PROVIDER_OUTCOME_UNKNOWN"]);
    });
  });

  // ── Release stage != evidence != commercial support != ready (the Flipkart rule) ──────────────────────────
  describe("an explicit live policy does not make a connector publication-ready", () => {
    const realPolicy = (slug: string) => {
      const policy = resolveConnectorLaunchPolicy(slug, ["PUBLISH", "VALIDATE", "STATUS_SYNC"]);
      return { launchStage: policy.launchStage, reason: policy.reason };
    };

    it("Flipkart is explicitly live, yet without pipeline evidence and a Product Owner record it is unavailable", () => {
      const result = evaluate({
        slug: "flipkart",
        launchPolicy: realPolicy(CONNECTOR_SLUGS.FLIPKART),
        evidence: [],
        commercialSupport: null,
      });
      expect(condition(result, "release_allowed").status).toBe("pass");
      expect(condition(result, "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
      expect(condition(result, "commercially_supported").code).toBe("NOT_COMMERCIALLY_SUPPORTED");
      expect(result.available).toBe(false);
    });

    it("Flipkart's TOKEN_ONLY VALID record is not provider verification", () => {
      const result = evaluate({
        slug: "flipkart",
        launchPolicy: realPolicy(CONNECTOR_SLUGS.FLIPKART),
        evidence: [pipelineEvidence({ connector: "flipkart" })],
        credential: { ...readyInput().credential!, lastOutcome: "VALID", lastValidProviderVerified: false },
      });
      expect(condition(result, "credential_acceptable").code).toBe("CREDENTIAL_NOT_PROVIDER_VERIFIED");
      expect(result.available).toBe(false);
    });

    it("WooCommerce is held by the real launch policy", () => {
      const result = evaluate({ slug: "woocommerce", launchPolicy: realPolicy(CONNECTOR_SLUGS.WOOCOMMERCE), evidence: [pipelineEvidence({ connector: "woocommerce" })] });
      expect(condition(result, "release_allowed").code).toBe("P1_BLOCKER_HOLD");
      expect(result.available).toBe(false);
    });

    it("with no evidence manifest yet (5.1b), no registered connector evaluates as available", () => {
      for (const slug of Object.values(CONNECTOR_SLUGS)) {
        const result = evaluate({ slug, launchPolicy: realPolicy(slug), evidence: [] });
        expect(result.available).toBe(false);
      }
    });
  });
});
