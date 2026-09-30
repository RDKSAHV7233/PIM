// Step 3 renders every version twice (desktop table and mobile cards), each with its own action forms, so a
// long history made the page several hundred KB. Show the newest versions plus anything actionable (live or
// validated) by default and let the operator expand the rest. Import-free so tests can execute it.

export interface WindowedVersion {
  id: string;
  lifecycleState: string;
  createdAt: string;
}

export const DEFAULT_VERSION_WINDOW = 10;

function createdAtMs(version: WindowedVersion): number {
  const ms = Date.parse(version.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

export function selectVisibleVersions<T extends WindowedVersion>(
  versions: T[],
  options: { showAll: boolean; limit?: number },
): { visible: T[]; hiddenCount: number } {
  const limit = Math.max(1, options.limit ?? DEFAULT_VERSION_WINDOW);
  if (options.showAll || versions.length <= limit) {
    return { visible: versions, hiddenCount: 0 };
  }
  const newestIds = new Set(
    [...versions]
      .sort((left, right) => createdAtMs(right) - createdAtMs(left))
      .slice(0, limit)
      .map((version) => version.id),
  );
  const visible = versions.filter(
    (version) => newestIds.has(version.id) || version.lifecycleState === "published" || version.lifecycleState === "validated",
  );
  return { visible, hiddenCount: versions.length - visible.length };
}
