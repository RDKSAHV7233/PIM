import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";

describe("IntelligenceCapabilityRegistry", () => {
  it("exposes only narrow AI-001 product intelligence capabilities", () => {
    const registry = new IntelligenceCapabilityRegistry();

    const capabilities = registry.listCapabilities();

    expect(capabilities.map((capability) => capability.id)).toEqual([
      "product_attribute_extraction",
      "product_specification_extraction",
      "evidence_backed_suggestions",
    ]);
    expect(capabilities.every((capability) => capability.ai001Scope === "in_scope")).toBe(true);
    expect(capabilities.every((capability) => capability.allowedEntityTypes.length === 1)).toBe(true);
    expect(capabilities.every((capability) => capability.allowedEntityTypes[0] === "product")).toBe(true);
  });

  it("keeps generation gated and non-mutating for every capability", () => {
    const registry = new IntelligenceCapabilityRegistry();

    expect(
      registry.listCapabilities().every((capability) => {
        return (
          capability.gateStatus === "blocked_until_gate_b" &&
          capability.providerExecution === false &&
          capability.canonicalMutation === false &&
          capability.humanReviewRequired === true &&
          capability.evidenceRequired === true
        );
      }),
    ).toBe(true);
  });

  it("classifies later product goals as outside AI-001 scope", () => {
    const registry = new IntelligenceCapabilityRegistry();

    expect(registry.isInAi001Scope("product_attribute_extraction")).toBe(true);
    expect(registry.isExplicitlyOutOfScope("supplier_intelligence")).toBe(true);
    expect(registry.isExplicitlyOutOfScope("semantic_quality_intelligence")).toBe(true);
    expect(registry.isExplicitlyOutOfScope("channel_intelligence")).toBe(true);
    expect(registry.isExplicitlyOutOfScope("copilot")).toBe(true);
    expect(registry.isExplicitlyOutOfScope("agents")).toBe(true);
    expect(registry.isExplicitlyOutOfScope("autonomous_publishing")).toBe(true);
  });

  it("returns defensive copies", () => {
    const registry = new IntelligenceCapabilityRegistry();
    const first = registry.listCapabilities();

    (first[0].allowedEntityTypes as unknown as string[]).push("other");

    expect(registry.getCapability("product_attribute_extraction").allowedEntityTypes).toEqual(["product"]);
  });
});
