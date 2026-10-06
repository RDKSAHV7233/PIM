import { resolveConnectorLaunchPolicy } from "../connector-framework/connector-launch-policy";
import { resolveCommercialSupportFact, type CommercialSupportRecord } from "./publication-target.commercial-support";
import { evaluatePublicationTarget } from "./publication-target.evaluator";
import { CONNECTOR_EVIDENCE_MANIFEST, PUBLISH_CONNECTOR_CAPABILITIES, evidenceForConnector, validateEvidenceManifest } from "./publication-target.evidence-manifest";
import {
  applyRecertificationTriggers,
  deriveCredentialFact,
  deriveTenantEntitlementFact,
  type EntitlementRow,
  type InstallationVerificationRow,
  type RecertificationTrigger,
} from "./publication-target.facts";
import type { CapabilityEvidence } from "./publication-target.types";
import { CONTEXT, DAY_MS, HOUR_MS, NOW, condition, pipelineEvidence, readyInput } from "./publication-target.test-fixtures";

const ago = (ms: number) => new Date(NOW.getTime() - ms);

// ── Tenant entitlement ──────────────────────────────────────────────────────────────────────────────────────
describe("deriveTenantEntitlementFact", () => {
  const row = (overrides: Partial<EntitlementRow> = {}): EntitlementRow => ({
    tenantKey: "tenant-a",
    connectorSlug: "zoho-inventory",
    releaseStage: "controlled_pilot",
    validFrom: ago(DAY_MS),
    validUntil: null,
    approvedAt: ago(DAY_MS),
    revokedAt: null,
    tenantOptedInAt: null,
    ...overrides,
  });
  const derive = (rows: readonly EntitlementRow[] | undefined, stage: "controlled_pilot" | "early_access" | "live" = "controlled_pilot") =>
    deriveTenantEntitlementFact({ tenantKey: "tenant-a", connector: "zoho-inventory", stage, rows, now: NOW });

  it("an active grant for the stage yields the fact", () => {
    expect(derive([row()])).toEqual({ releaseStage: "controlled_pilot", validFrom: ago(DAY_MS), validUntil: null, revokedAt: null });
  });

  it("rows that could not be read are unknown, not 'no entitlement'", () => {
    expect(derive(undefined)).toBeUndefined();
    expect(derive(undefined, "early_access")).toBeUndefined();
  });

  it("no rows is a known absence", () => {
    expect(derive([])).toBeNull();
  });

  it("live has no cohort, so no fact is needed", () => {
    expect(derive([row()], "live")).toBeNull();
  });

  it("a stage that does not publish has no cohort either", () => {
    const fact = deriveTenantEntitlementFact({ tenantKey: "tenant-a", connector: "zoho-inventory", stage: "p1_blocker_hold", rows: [row()], now: NOW });
    expect(fact).toBeNull();
  });

  it.each([
    ["another tenant", row({ tenantKey: "tenant-b" })],
    ["another connector", row({ connectorSlug: "odoo" })],
    ["another stage", row({ releaseStage: "early_access", tenantOptedInAt: ago(DAY_MS) })],
    ["a grant that has not started", row({ validFrom: new Date(NOW.getTime() + 1) })],
    ["an expired grant", row({ validUntil: new Date(NOW.getTime() - 1) })],
    ["a grant expiring exactly now", row({ validUntil: NOW })],
    ["a revoked grant", row({ revokedAt: new Date(NOW.getTime() - 1) })],
    ["a grant revoked exactly now", row({ revokedAt: NOW })],
  ])("does not count %s", (_label, candidate) => {
    expect(derive([candidate])).toBeNull();
  });

  it("another tenant's grant is ignored even when the caller passes it", () => {
    expect(derive([row({ tenantKey: "tenant-b" }), row({ tenantKey: "tenant-c" })])).toBeNull();
  });

  it("a connector slug is matched after normalization", () => {
    expect(derive([row({ connectorSlug: "  Zoho-Inventory " })])).not.toBeNull();
  });

  it("early_access needs the tenant's own opt-in as well as the grant", () => {
    expect(derive([row({ releaseStage: "early_access", tenantOptedInAt: null })], "early_access")).toBeNull();
    expect(derive([row({ releaseStage: "early_access", tenantOptedInAt: ago(HOUR_MS) })], "early_access")).not.toBeNull();
  });

  it("the newest active grant is used", () => {
    const fact = deriveTenantEntitlementFact({
      tenantKey: "tenant-a",
      connector: "zoho-inventory",
      stage: "controlled_pilot",
      rows: [row({ approvedAt: ago(3 * DAY_MS), validFrom: ago(3 * DAY_MS) }), row({ approvedAt: ago(HOUR_MS), validFrom: ago(HOUR_MS) })],
      now: NOW,
    });
    expect(fact?.validFrom).toEqual(ago(HOUR_MS));
  });

  describe("the newest grant decides; an older grant that still looks valid never revives an ended one", () => {
    const older = (over: Partial<EntitlementRow> = {}) => row({ approvedAt: ago(10 * DAY_MS), validFrom: ago(10 * DAY_MS), ...over });
    const newer = (over: Partial<EntitlementRow> = {}) => row({ approvedAt: ago(2 * DAY_MS), validFrom: ago(2 * DAY_MS), ...over });

    it("a newer grant at a DIFFERENT stage does not decide this stage's entitlement", () => {
      const pilot = older();
      const laterEarlyAccessRevoked = newer({ releaseStage: "early_access", tenantOptedInAt: ago(3 * DAY_MS), revokedAt: ago(DAY_MS) });
      const laterEarlyAccessActive = newer({ releaseStage: "early_access", tenantOptedInAt: ago(3 * DAY_MS) });
      // the controlled_pilot grant stands whatever happened to a newer early_access grant, and vice versa
      expect(derive([pilot, laterEarlyAccessRevoked])).not.toBeNull();
      expect(derive([pilot, laterEarlyAccessActive])).not.toBeNull();
      expect(derive([pilot, laterEarlyAccessRevoked], "early_access")).toBeNull();
      expect(derive([pilot, laterEarlyAccessActive], "early_access")).not.toBeNull();
    });

    it("an older active grant plus a newer REVOKED grant: no entitlement", () => {
      expect(derive([older(), newer({ revokedAt: ago(DAY_MS) })])).toBeNull();
    });

    it("an older active grant plus a newer EXPIRED grant: no entitlement", () => {
      expect(derive([older(), newer({ validUntil: ago(HOUR_MS) })])).toBeNull();
    });

    it("the order the rows are passed in does not matter", () => {
      const rows = [older(), newer({ revokedAt: ago(DAY_MS) })];
      expect(derive(rows)).toBeNull();
      expect(derive([...rows].reverse())).toBeNull();
    });

    it("an older ended grant plus a newer active grant: entitled by the newer one", () => {
      const fact = derive([older({ revokedAt: ago(5 * DAY_MS) }), newer()]);
      expect(fact?.validFrom).toEqual(ago(2 * DAY_MS));
    });

    it("a newer grant that has not started yet neither revokes nor replaces the current one", () => {
      const scheduled = newer({ approvedAt: ago(HOUR_MS), validFrom: new Date(NOW.getTime() + DAY_MS) });
      const fact = derive([older(), scheduled]);
      expect(fact?.validFrom).toEqual(ago(10 * DAY_MS));
    });

    it("a newer grant that starts later and is already revoked does not end the current one before it starts", () => {
      const scheduledThenRevoked = newer({ approvedAt: ago(HOUR_MS), validFrom: new Date(NOW.getTime() + DAY_MS), revokedAt: ago(1000) });
      expect(derive([older(), scheduledThenRevoked])).not.toBeNull();
    });

    it("equal approval times cannot be ordered, so every tied grant must hold", () => {
      const at = ago(3 * DAY_MS);
      expect(derive([row({ approvedAt: at, validFrom: at }), row({ approvedAt: at, validFrom: at, revokedAt: ago(DAY_MS) })])).toBeNull();
      expect(derive([row({ approvedAt: at, validFrom: at }), row({ approvedAt: at, validFrom: at })])).not.toBeNull();
    });

    it("a revocation that has not yet taken effect does not end the grant", () => {
      expect(derive([newer({ revokedAt: new Date(NOW.getTime() + DAY_MS) })])).not.toBeNull();
    });

    it("an unreadable date on a row for this tenant, connector and stage makes the whole fact unknown", () => {
      expect(derive([older(), newer({ approvedAt: new Date("nope") })])).toBeUndefined();
      expect(derive([older(), newer({ validFrom: new Date("nope") })])).toBeUndefined();
    });

    it("an unreadable row for another tenant or connector is ignored", () => {
      expect(derive([older(), row({ tenantKey: "tenant-b", approvedAt: new Date("nope") })])).not.toBeNull();
      expect(derive([older(), row({ connectorSlug: "odoo", approvedAt: new Date("nope") })])).not.toBeNull();
    });

    it("a revoked newer grant overrides the older one through the evaluator too", () => {
      const result = evaluatePublicationTarget(
        readyInput({
          launchPolicy: { launchStage: "controlled_pilot" },
          evidence: [pipelineEvidence({ level: "sandbox_verified" })],
          tenantEntitlement: derive([older(), newer({ revokedAt: ago(DAY_MS) })]),
        }),
        CONTEXT,
      );
      expect(condition(result, "release_allowed").code).toBe("RELEASE_RESTRICTED");
    });
  });

  it("an invalid evaluation time is unknown", () => {
    expect(deriveTenantEntitlementFact({ tenantKey: "tenant-a", connector: "zoho-inventory", stage: "controlled_pilot", rows: [row()], now: new Date("x") })).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const rows = [row()];
    const snapshot = JSON.stringify(rows);
    derive(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

// ── Provider-verified credential ────────────────────────────────────────────────────────────────────────────
describe("deriveCredentialFact", () => {
  const install = (overrides: Partial<InstallationVerificationRow> = {}): InstallationVerificationRow => ({
    status: "ACTIVE",
    lastValidationOutcome: "VALID",
    lastValidatedAt: ago(2 * HOUR_MS),
    lastProviderVerifiedAt: ago(2 * HOUR_MS),
    lastProviderVerificationKind: "PROVIDER_AUTHENTICATED",
    ...overrides,
  });

  it("an unread row is unknown; a missing installation is absent", () => {
    expect(deriveCredentialFact(undefined, NOW)).toBeUndefined();
    expect(deriveCredentialFact(null, NOW)).toBeNull();
  });

  it("a provider-authenticated validation is provider-verified, and freshness runs from that time", () => {
    expect(deriveCredentialFact(install(), NOW)).toEqual({
      installationStatus: "ACTIVE",
      lastOutcome: "VALID",
      lastValidAt: ago(2 * HOUR_MS),
      lastValidProviderVerified: true,
    });
  });

  it("a validation with no provider verification is not provider-verified (TOKEN_ONLY)", () => {
    const fact = deriveCredentialFact(install({ lastProviderVerifiedAt: null, lastProviderVerificationKind: null }), NOW);
    expect(fact).toMatchObject({ lastOutcome: "VALID", lastValidProviderVerified: false, lastValidAt: ago(2 * HOUR_MS) });
  });

  it("a later token-only VALID does not refresh a stale provider verification", () => {
    const fact = deriveCredentialFact(install({ lastValidatedAt: ago(HOUR_MS), lastProviderVerifiedAt: ago(100 * HOUR_MS) }), NOW);
    expect(fact?.lastValidAt).toEqual(ago(100 * HOUR_MS));
    expect(fact?.lastValidProviderVerified).toBe(true);
  });

  it("a later INDETERMINATE attempt keeps the provider verification (the point of separate columns)", () => {
    const fact = deriveCredentialFact(install({ lastValidationOutcome: "INDETERMINATE", lastValidatedAt: ago(10 * HOUR_MS) }), NOW);
    expect(fact).toMatchObject({ lastOutcome: "INDETERMINATE", lastValidProviderVerified: true, lastValidAt: ago(2 * HOUR_MS) });
  });

  it.each([
    ["TOKEN_ONLY recorded as the kind", { lastProviderVerificationKind: "TOKEN_ONLY" }],
    ["a free-text kind", { lastProviderVerificationKind: "authenticated with the provider" }],
    ["a missing kind", { lastProviderVerificationKind: null }],
    ["a lower-case kind", { lastProviderVerificationKind: "provider_authenticated" }],
  ])("%s is not provider verification", (_label, overrides) => {
    expect(deriveCredentialFact(install(overrides), NOW)?.lastValidProviderVerified).toBe(false);
  });

  it.each([
    ["an unrecognized outcome", { lastValidationOutcome: "HEALTHY" }],
    ["an invalid validation date", { lastValidatedAt: new Date("x") }],
    ["a future validation date", { lastValidatedAt: new Date(NOW.getTime() + HOUR_MS) }],
    ["an invalid provider-verification date", { lastProviderVerifiedAt: new Date("x") }],
    ["a future provider-verification date", { lastProviderVerifiedAt: new Date(NOW.getTime() + HOUR_MS) }],
  ])("%s is unknown", (_label, overrides) => {
    expect(deriveCredentialFact(install(overrides), NOW)).toBeUndefined();
  });

  it("a never-validated installation carries no time and no outcome", () => {
    const fact = deriveCredentialFact(install({ lastValidationOutcome: null, lastValidatedAt: null, lastProviderVerifiedAt: null, lastProviderVerificationKind: null }), NOW);
    expect(fact).toEqual({ installationStatus: "ACTIVE", lastOutcome: null, lastValidAt: null, lastValidProviderVerified: false });
  });

  it("the installation status is passed through (CREDENTIAL_EXPIRED is what INVALID writes)", () => {
    expect(deriveCredentialFact(install({ status: "CREDENTIAL_EXPIRED", lastValidationOutcome: "INVALID" }), NOW)).toMatchObject({
      installationStatus: "CREDENTIAL_EXPIRED",
      lastOutcome: "INVALID",
    });
  });

  describe("through the evaluator", () => {
    const evaluateCredential = (overrides: Partial<InstallationVerificationRow>) =>
      condition(
        evaluatePublicationTarget(readyInput({ credential: deriveCredentialFact(install(overrides), NOW) }), CONTEXT),
        "credential_acceptable",
      );

    it("provider-verified and recent: pass", () => expect(evaluateCredential({}).status).toBe("pass"));

    it("token-only VALID (the amazon-in / flipkart case): CREDENTIAL_NOT_PROVIDER_VERIFIED", () => {
      expect(evaluateCredential({ lastProviderVerifiedAt: null, lastProviderVerificationKind: null }).code).toBe("CREDENTIAL_NOT_PROVIDER_VERIFIED");
    });

    it("recent provider verification then INDETERMINATE: a warning, still available", () => {
      const result = evaluatePublicationTarget(
        readyInput({ credential: deriveCredentialFact(install({ lastValidationOutcome: "INDETERMINATE", lastValidatedAt: ago(10 * HOUR_MS) }), NOW) }),
        CONTEXT,
      );
      expect(condition(result, "credential_acceptable").code).toBe("CREDENTIAL_CHECK_INCONCLUSIVE");
      expect(result.available).toBe(true);
    });

    it("provider verification older than the window: CREDENTIAL_STALE, whatever the token-only times say", () => {
      expect(evaluateCredential({ lastValidatedAt: ago(HOUR_MS), lastProviderVerifiedAt: ago(100 * HOUR_MS) }).code).toBe("CREDENTIAL_STALE");
    });

    it("INVALID and CONFIGURATION_ERROR still block", () => {
      expect(evaluateCredential({ lastValidationOutcome: "INVALID" }).code).toBe("CREDENTIAL_INVALID");
      expect(evaluateCredential({ lastValidationOutcome: "CONFIGURATION_ERROR" }).code).toBe("CREDENTIAL_CONFIGURATION_ERROR");
    });

    it("an unreadable row makes the target unavailable, never available", () => {
      const result = evaluatePublicationTarget(readyInput({ credential: deriveCredentialFact(install({ lastValidationOutcome: "HEALTHY" }), NOW) }), CONTEXT);
      expect(condition(result, "credential_acceptable").status).toBe("unknown");
      expect(result.available).toBe(false);
    });
  });
});

// ── Recertification triggers ────────────────────────────────────────────────────────────────────────────────
describe("applyRecertificationTriggers", () => {
  const evidence = (overrides: Partial<CapabilityEvidence> = {}): CapabilityEvidence =>
    pipelineEvidence({ connector: "shopify", level: "production_verified", verifiedAt: "2026-10-06", reverifyBy: "2026-11-05T00:00:00.000Z", ...overrides });
  const trigger = (overrides: Partial<RecertificationTrigger> = {}): RecertificationTrigger => ({
    connector: "shopify",
    kind: "SCHEMA_REMAP_REQUIRED",
    occurredAt: "2026-10-10T00:00:00.000Z",
    ref: "mapping-version-123",
    ...overrides,
  });

  it("a change after verification annotates the evidence with why, and records the effective date", () => {
    const [result] = applyRecertificationTriggers([evidence()], [trigger()]);
    expect(result?.recertification).toEqual({ kind: "SCHEMA_REMAP_REQUIRED", at: "2026-10-10T00:00:00.000Z", ref: "mapping-version-123" });
  });

  it("the original certification record is preserved exactly: only the annotation is added", () => {
    const original = evidence({
      evidenceRef: "AI-run QA 2026-10-06",
      verifiedBy: "QA",
      evidenceRole: "QA",
      executionType: "AI_RUN",
      humanApproval: false,
      environment: "PRODUCTION",
      fixture: "QAPILOT-20260824-001",
      submissionIds: ["6ae9670d-b62e-41dc-bb34-d649c62898b6"],
      assertions: { publishSucceeded: true },
      limitations: ["store-side inspection not performed"],
    });
    const [result] = applyRecertificationTriggers([original], [trigger()]);
    const { recertification, ...rest } = result!;
    expect(recertification).toBeDefined();
    expect(rest).toEqual(original);
    expect(result?.verifiedAt).toBe("2026-10-06");
    expect(result?.reverifyBy).toBe("2026-11-05T00:00:00.000Z");
    expect(result?.submissionIds).toEqual(["6ae9670d-b62e-41dc-bb34-d649c62898b6"]);
    expect(result?.limitations).toEqual(["store-side inspection not performed"]);
  });

  it("the evaluator uses the earlier of reverifyBy and the change as the effective expiry", () => {
    const early = (now: Date, triggers: RecertificationTrigger[]) =>
      condition(
        evaluatePublicationTarget(
          readyInput({ slug: "shopify", launchPolicy: { launchStage: "early_access" }, evidence: applyRecertificationTriggers([evidence()], triggers) }),
          { ...CONTEXT, now },
        ),
        "capability_verified",
      );
    // the change is 2026-10-10; the recorded reverifyBy is 2026-11-05
    expect(early(new Date("2026-10-09T00:00:00Z"), [trigger()]).status).toBe("pass");
    expect(early(new Date("2026-10-10T00:00:00Z"), [trigger()]).code).toBe("RECERTIFICATION_REQUIRED");
    expect(early(new Date("2026-10-20T00:00:00Z"), [trigger()]).code).toBe("RECERTIFICATION_REQUIRED");
    // without the change, the same evidence is current on those dates
    expect(early(new Date("2026-10-20T00:00:00Z"), []).status).toBe("pass");
  });

  it("the evaluator then reports RECERTIFICATION_REQUIRED once the change has happened, even before the original date", () => {
    const early = (now: Date, triggers: RecertificationTrigger[]) =>
      condition(
        evaluatePublicationTarget(
          readyInput({ slug: "shopify", launchPolicy: { launchStage: "early_access" }, evidence: applyRecertificationTriggers([evidence()], triggers) }),
          { ...CONTEXT, now },
        ),
        "capability_verified",
      );
    const mid = new Date("2026-10-20T00:00:00Z"); // before 2026-11-05, after the change
    expect(early(mid, []).status).toBe("pass");
    expect(early(mid, [trigger()]).code).toBe("RECERTIFICATION_REQUIRED");
  });

  it("a change before or at verification changes nothing: the evidence was gathered afterwards", () => {
    for (const occurredAt of ["2026-09-30T00:00:00.000Z", "2026-10-06T00:00:00.000Z"]) {
      const [result] = applyRecertificationTriggers([evidence()], [trigger({ occurredAt })]);
      expect(result).toEqual(evidence());
    }
  });

  it("a change in the future takes effect when it happens", () => {
    const [result] = applyRecertificationTriggers([evidence()], [trigger({ occurredAt: "2026-10-30T00:00:00.000Z" })]);
    expect(result?.recertification?.at).toBe("2026-10-30T00:00:00.000Z");
    expect(result?.reverifyBy).toBe("2026-11-05T00:00:00.000Z");
  });

  it("if the evidence's own date already comes first, the change is not blamed", () => {
    const [result] = applyRecertificationTriggers([evidence()], [trigger({ occurredAt: "2026-12-01T00:00:00.000Z" })]);
    expect(result).toEqual(evidence());
    expect(result?.recertification).toBeUndefined();
  });

  it("the earliest applicable change wins", () => {
    const [result] = applyRecertificationTriggers(
      [evidence()],
      [trigger({ occurredAt: "2026-10-20T00:00:00.000Z", kind: "PROVIDER_API_VERSION_CHANGE" }), trigger({ occurredAt: "2026-10-12T00:00:00.000Z", kind: "CONNECTOR_VERSION_CHANGE" })],
    );
    expect(result?.recertification?.kind).toBe("CONNECTOR_VERSION_CHANGE");
    expect(result?.recertification?.at).toBe("2026-10-12T00:00:00.000Z");
    expect(result?.reverifyBy).toBe("2026-11-05T00:00:00.000Z");
  });

  it("a trigger for one capability, or another connector, does not touch other evidence", () => {
    const publish = evidence({ capability: "PUBLISH" });
    const validate = evidence({ capability: "VALIDATE" });
    const other = evidence({ connector: "odoo" });
    const results = applyRecertificationTriggers([publish, validate, other], [trigger({ capability: "PUBLISH" })]);
    expect(results[0]?.recertification).toBeDefined();
    expect(results[1]).toEqual(validate);
    expect(results[2]).toEqual(other);
  });

  it("a trigger without a capability applies to every capability of the connector", () => {
    const results = applyRecertificationTriggers([evidence({ capability: "PUBLISH" }), evidence({ capability: "VALIDATE" })], [trigger()]);
    expect(results.every((entry) => entry.recertification !== undefined)).toBe(true);
  });

  it("an unparseable trigger date fails closed: the evidence is treated as already due", () => {
    const [result] = applyRecertificationTriggers([evidence()], [trigger({ occurredAt: "sometime" })]);
    expect(Date.parse(result!.recertification!.at)).toBeLessThanOrEqual(NOW.getTime());
    expect(result?.reverifyBy).toBe("2026-11-05T00:00:00.000Z");
  });

  it("untested evidence is untouched", () => {
    const untested = pipelineEvidence({ connector: "shopify", level: "untested", evidenceRef: null, verifiedAt: null, verifiedBy: null, reverifyBy: null });
    expect(applyRecertificationTriggers([untested], [trigger()])).toEqual([untested]);
  });

  it("does not mutate its input", () => {
    const entries = [evidence()];
    const snapshot = JSON.stringify(entries);
    applyRecertificationTriggers(entries, [trigger()]);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("the committed manifest rejects a hand-recorded recertification", () => {
    const manifest = CONNECTOR_EVIDENCE_MANIFEST.map((entry) =>
      entry.connector === "shopify" && entry.capability === "PUBLISH" && entry.path === "product_pipeline"
        ? { ...entry, recertification: { kind: "SCHEMA_REMAP_REQUIRED", at: "2026-10-10T00:00:00.000Z", ref: null } }
        : entry,
    );
    expect(validateEvidenceManifest(manifest).join("\n")).toMatch(/recertification is derived and must not be recorded/);
    expect(validateEvidenceManifest(CONNECTOR_EVIDENCE_MANIFEST)).toEqual([]);
  });
});

// ── All five derived facts together, through the evaluator ──────────────────────────────────────────────────
describe("derived facts, end to end", () => {
  const at = new Date("2026-10-10T00:00:00Z");
  const verified = new Date("2026-10-09T22:00:00Z");

  const poRecord: CommercialSupportRecord = {
    connector: "shopify",
    commerciallySupported: true,
    approvedBy: "PO",
    approvalRef: "PO-REF-1",
    approvedAt: "2026-10-08T00:00:00.000Z",
    validUntil: null,
    revokedAt: null,
    reason: "supported for the early-access cohort",
  };
  const grant: EntitlementRow = {
    tenantKey: "tenant-a",
    connectorSlug: "shopify",
    releaseStage: "early_access",
    validFrom: new Date("2026-10-08T00:00:00Z"),
    validUntil: null,
    approvedAt: new Date("2026-10-08T00:00:00Z"),
    revokedAt: null,
    tenantOptedInAt: new Date("2026-10-08T00:00:00Z"),
  };
  const install: InstallationVerificationRow = {
    status: "ACTIVE",
    lastValidationOutcome: "VALID",
    lastValidatedAt: verified,
    lastProviderVerifiedAt: verified,
    lastProviderVerificationKind: "PROVIDER_AUTHENTICATED",
  };

  function evaluateShopify(over: {
    triggers?: RecertificationTrigger[];
    support?: CommercialSupportRecord[];
    grants?: EntitlementRow[] | undefined;
    installation?: InstallationVerificationRow | null | undefined;
  } = {}) {
    const policy = { launchStage: "early_access" as const };
    return evaluatePublicationTarget(
      readyInput({
        slug: "shopify",
        scope: "tenant",
        product: undefined,
        priorOutcome: undefined,
        definition: { slug: "shopify", displayName: "Shopify", isActive: true, capabilities: [...PUBLISH_CONNECTOR_CAPABILITIES.shopify!] },
        launchPolicy: policy,
        evidence: applyRecertificationTriggers(evidenceForConnector("shopify"), over.triggers ?? []),
        commercialSupport: resolveCommercialSupportFact("shopify", at, over.support ?? [poRecord]),
        tenantEntitlement: deriveTenantEntitlementFact({
          tenantKey: "tenant-a",
          connector: "shopify",
          stage: policy.launchStage,
          rows: "grants" in over ? over.grants : [grant],
          now: at,
        }),
        credential: deriveCredentialFact("installation" in over ? over.installation : install, at),
      }),
      { ...CONTEXT, now: at },
    );
  }

  it("with the real manifest evidence, a PO record, an entitlement and a provider-verified credential, Shopify at early_access is available", () => {
    const result = evaluateShopify();
    expect(result.reasonCodes).toEqual([]);
    expect(result.available).toBe(true);
  });

  it.each([
    ["no Product Owner record", { support: [] }, "NOT_COMMERCIALLY_SUPPORTED"],
    ["no entitlement", { grants: [] }, "RELEASE_RESTRICTED"],
    ["an unreadable entitlement lookup", { grants: undefined }, "EVALUATION_UNAVAILABLE"],
    ["a schema change after verification", { triggers: [{ connector: "shopify", kind: "SCHEMA_REMAP_REQUIRED" as const, occurredAt: "2026-10-09T23:00:00Z", ref: null }] }, "RECERTIFICATION_REQUIRED"],
    ["a token-only credential", { installation: { ...install, lastProviderVerifiedAt: null, lastProviderVerificationKind: null } }, "CREDENTIAL_NOT_PROVIDER_VERIFIED"],
    ["an unreadable installation row", { installation: undefined }, "EVALUATION_UNAVAILABLE"],
  ])("removing or breaking one fact flips it: %s", (_label, over, code) => {
    const result = evaluateShopify(over as Parameters<typeof evaluateShopify>[0]);
    expect(result.available).toBe(false);
    expect(result.reasonCodes).toContain(code);
  });

  it("without the derivations the same target is not available: the facts are what make it so", () => {
    const policy = resolveConnectorLaunchPolicy("shopify", ["PUBLISH"]);
    expect(policy.launchStage).toBe("live"); // the real policy: live needs certified evidence, which nothing has
    const result = evaluatePublicationTarget(readyInput({ slug: "shopify", evidence: evidenceForConnector("shopify") }), { ...CONTEXT, now: at });
    expect(condition(result, "capability_verified").code).toBe("CAPABILITY_NOT_VERIFIED");
  });
});
