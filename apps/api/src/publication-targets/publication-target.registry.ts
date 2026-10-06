import type { ConnectorDefinitionFact } from "./publication-target.types";

/**
 * Publication-target registry (ADR-0015, Sprint 5.1b): the set of connectors that could be publication targets,
 * derived from what is authoritative, never from the Tier-1 MARKETPLACE_CHANNELS mapping-pack list.
 *
 *   authoritative = connector definitions (connector_definitions rows) and runtime registration (ConnectorRegistry)
 *
 * Pure: the caller supplies both sets, so this reads no database and no registry. Being a candidate is not being
 * available; the evaluator decides that.
 */

export type PublicationTargetKind =
  /** Declares PUBLISH: a selectable publication target (available or not). */
  | "publication_target"
  /** Declares an export capability but not PUBLISH: not a publication target (diagnostics may explain why). */
  | "export_only"
  /** Neither, or no definition at all. */
  | "other";

export interface PublicationTargetCandidate {
  key: string;
  displayName: string | null;
  definition: ConnectorDefinitionFact | null;
  runtimeRegistered: boolean;
  declaredCapabilities: readonly string[];
  kind: PublicationTargetKind;
}

export interface PublicationTargetRegistryInput {
  definitions: readonly ConnectorDefinitionFact[];
  registeredSlugs: readonly string[];
}

const EXPORT_CAPABILITIES: ReadonlySet<string> = new Set(["EXCEL_EXPORT"]);

function normalizeSlug(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Every connector known to either source, sorted by key. A slug present in only one source is still listed. */
export function derivePublicationTargetCandidates(input: PublicationTargetRegistryInput): PublicationTargetCandidate[] {
  const definitionsBySlug = new Map<string, ConnectorDefinitionFact>();
  for (const definition of input.definitions) {
    const slug = normalizeSlug(definition.slug);
    // First wins: a duplicate slug never silently replaces the definition already seen.
    if (slug && !definitionsBySlug.has(slug)) definitionsBySlug.set(slug, definition);
  }
  const registered = new Set(input.registeredSlugs.map(normalizeSlug).filter((slug) => slug.length > 0));

  const keys = new Set<string>([...definitionsBySlug.keys(), ...registered]);
  return [...keys].sort().map((key) => {
    const definition = definitionsBySlug.get(key) ?? null;
    const declaredCapabilities = definition ? [...definition.capabilities] : [];
    return {
      key,
      displayName: definition?.displayName ?? null,
      definition,
      runtimeRegistered: registered.has(key),
      declaredCapabilities,
      kind: classify(declaredCapabilities),
    };
  });
}

function classify(capabilities: readonly string[]): PublicationTargetKind {
  if (capabilities.includes("PUBLISH")) return "publication_target";
  if (capabilities.some((capability) => EXPORT_CAPABILITIES.has(capability))) return "export_only";
  return "other";
}

/** The candidates a seller can select. Export-only connectors are excluded (they stay on export surfaces). */
export function selectablePublicationTargets(candidates: readonly PublicationTargetCandidate[]): PublicationTargetCandidate[] {
  return candidates.filter((candidate) => candidate.kind === "publication_target");
}
