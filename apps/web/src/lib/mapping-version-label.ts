// A stable, human-distinguishable ordinal for mapping versions sharing the same scope.
//
// The versions table's "Version" column used to show only connectorDefinitionVersion (the
// connector schema version, e.g. "0.1.0") as its primary label -- identical across every
// version built against the same connector, so two independent drafts for the same scope
// were indistinguishable except by a raw UUID. ConnectorMappingVersion has no incrementing
// per-mapping field to fall back on, so this computes one client-side. Kept import-free so
// the ordinal rules can be executed directly by tests.

export interface MappingVersionOrdinalLike {
  id: string;
  categoryScope: string;
  mappingLevel: string;
  createdAt: string;
}

function createdAtMs(version: MappingVersionOrdinalLike): number {
  const ms = Date.parse(version.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function ordinalGroupKey(version: MappingVersionOrdinalLike): string {
  return `${version.categoryScope}::${version.mappingLevel}`;
}

/**
 * A 1-based ordinal per version, keyed by version id, stable across archiving. Must be
 * computed over the full version set fetched with includeArchived: true (never a filtered
 * subset) -- positions are assigned by creation order among ALL versions in a scope, so a
 * version's number never changes once assigned, even after an older sibling is archived.
 */
export function computeVersionOrdinals<T extends MappingVersionOrdinalLike>(versions: T[]): Map<string, number> {
  const groups = new Map<string, T[]>();
  for (const version of versions) {
    const key = ordinalGroupKey(version);
    const group = groups.get(key);
    if (group) {
      group.push(version);
    } else {
      groups.set(key, [version]);
    }
  }

  const ordinals = new Map<string, number>();
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const diff = createdAtMs(a) - createdAtMs(b);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
    sorted.forEach((version, index) => {
      ordinals.set(version.id, index + 1);
    });
  }
  return ordinals;
}
