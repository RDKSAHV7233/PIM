import { CONNECTOR_SLUGS } from "../connector-framework/connector.constants";
import { derivePublicationTargetCandidates, selectablePublicationTargets } from "./publication-target.registry";
import type { ConnectorDefinitionFact } from "./publication-target.types";

const definition = (slug: string, capabilities: string[], over: Partial<ConnectorDefinitionFact> = {}): ConnectorDefinitionFact => ({
  slug,
  displayName: slug.toUpperCase(),
  isActive: true,
  capabilities,
  ...over,
});

describe("derivePublicationTargetCandidates", () => {
  it("derives candidates from definitions and runtime registration, sorted by key", () => {
    const candidates = derivePublicationTargetCandidates({
      definitions: [definition("zoho-inventory", ["PUBLISH"]), definition("etsy", ["PUBLISH"])],
      registeredSlugs: ["etsy", "zoho-inventory"],
    });
    expect(candidates.map((c) => c.key)).toEqual(["etsy", "zoho-inventory"]);
    expect(candidates.every((c) => c.runtimeRegistered && c.definition !== null && c.kind === "publication_target")).toBe(true);
  });

  it("a definition without a registered runtime is a candidate that is not registered", () => {
    const [candidate] = derivePublicationTargetCandidates({ definitions: [definition("acme", ["PUBLISH"])], registeredSlugs: [] });
    expect(candidate).toMatchObject({ key: "acme", runtimeRegistered: false, kind: "publication_target" });
  });

  it("a registered runtime without a definition is listed, has no definition, and is not selectable", () => {
    const candidates = derivePublicationTargetCandidates({ definitions: [], registeredSlugs: ["ghost"] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ key: "ghost", definition: null, runtimeRegistered: true, kind: "other" });
    expect(selectablePublicationTargets(candidates)).toEqual([]);
  });

  it("classifies by declared capabilities: PUBLISH is a target, export-only is not, neither is other", () => {
    const candidates = derivePublicationTargetCandidates({
      definitions: [
        definition("pub", ["PUBLISH", "EXCEL_EXPORT"]),
        definition("export", ["VALIDATE", "EXCEL_EXPORT"]),
        definition("neither", ["VALIDATE"]),
      ],
      registeredSlugs: ["pub", "export", "neither"],
    });
    expect(Object.fromEntries(candidates.map((c) => [c.key, c.kind]))).toEqual({
      export: "export_only",
      neither: "other",
      pub: "publication_target",
    });
    expect(selectablePublicationTargets(candidates).map((c) => c.key)).toEqual(["pub"]);
  });

  it("an inactive definition still lists (the evaluator reports it), keeping its declared kind", () => {
    const [candidate] = derivePublicationTargetCandidates({ definitions: [definition("acme", ["PUBLISH"], { isActive: false })], registeredSlugs: ["acme"] });
    expect(candidate?.kind).toBe("publication_target");
    expect(candidate?.definition?.isActive).toBe(false);
  });

  it("normalizes slugs and de-duplicates, with the first definition winning", () => {
    const candidates = derivePublicationTargetCandidates({
      definitions: [definition(" Acme ", ["PUBLISH"], { displayName: "First" }), definition("acme", ["EXCEL_EXPORT"], { displayName: "Second" })],
      registeredSlugs: ["ACME", "acme", "  "],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ key: "acme", displayName: "First", kind: "publication_target", runtimeRegistered: true });
  });

  it("is not limited to any hardcoded channel list: a slug that is in no list at all is a candidate", () => {
    const candidates = derivePublicationTargetCandidates({
      definitions: [definition("brand-new-marketplace", ["PUBLISH"])],
      registeredSlugs: ["brand-new-marketplace"],
    });
    expect(selectablePublicationTargets(candidates).map((c) => c.key)).toEqual(["brand-new-marketplace"]);
  });

  it("covers every registered connector slug from fixtures", () => {
    const slugs = Object.values(CONNECTOR_SLUGS);
    const candidates = derivePublicationTargetCandidates({
      definitions: slugs.map((slug) => definition(slug, ["PUBLISH"])),
      registeredSlugs: slugs,
    });
    expect(candidates.map((c) => c.key).sort()).toEqual([...slugs].sort());
  });

  it("does not mutate its input", () => {
    const input = { definitions: [definition("acme", ["PUBLISH"])], registeredSlugs: ["acme"] };
    const snapshot = JSON.stringify(input);
    derivePublicationTargetCandidates(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
