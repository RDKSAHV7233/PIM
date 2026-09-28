// Which saved mapping version the Step 2 editor should resume from.
//
// A saved draft lives in the version history, not in the live/system-default map the
// editor used to seed from, so without this the operator's saved work reappears as
// "Missing" and a second save rebuilds the draft from defaults. Kept import-free so
// the selection rules can be executed directly by tests.

type FieldMapValue = string | string[];

export interface MappingVersionLike {
  id: string;
  lifecycleState: string;
  createdAt: string;
  archivedAt?: string | null;
  mappingRules?: Record<string, unknown> | null;
}

const UNPUBLISHED_STATES = new Set(["draft", "validated"]);

function createdAtMs(version: MappingVersionLike): number {
  const ms = Date.parse(version.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The newest non-archived draft/validated version saved after the latest published
 * one, or null when there is nothing newer than the live mapping to resume.
 */
export function selectWorkingDraft<T extends MappingVersionLike>(versions: T[]): T | null {
  const latestPublishedMs = versions
    .filter((version) => version.lifecycleState === "published")
    .reduce((latest, version) => Math.max(latest, createdAtMs(version)), Number.NEGATIVE_INFINITY);
  let working: T | null = null;
  for (const version of versions) {
    if (!UNPUBLISHED_STATES.has(version.lifecycleState) || version.archivedAt) continue;
    if (createdAtMs(version) <= latestPublishedMs) continue;
    if (!working || createdAtMs(version) > createdAtMs(working)) working = version;
  }
  return working;
}

/** The working draft's source -> target field map, or null when it has none. */
export function workingDraftFieldMap(version: MappingVersionLike | null): Record<string, FieldMapValue> | null {
  const raw = version?.mappingRules?.field_mappings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fieldMap: Record<string, FieldMapValue> = {};
  for (const [source, target] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof target === "string") {
      fieldMap[source] = target;
    } else if (Array.isArray(target) && target.every((item) => typeof item === "string")) {
      fieldMap[source] = target as string[];
    }
  }
  return fieldMap;
}
