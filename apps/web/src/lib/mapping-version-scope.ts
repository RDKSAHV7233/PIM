// Mapping versions come back from the API for BOTH the selected connector account and "all
// accounts" (installationId null). Each scope has its own independent published slot, and the
// resolver prefers the account-scoped version, so the UI has to show the scope and pick the
// "active" version the same way.

export interface ScopedVersionFields {
  id: string;
  lifecycleState: string;
  installationId?: string | null;
  publishedAt?: string | null;
  updatedAt: string;
}

export function presentInstallationScope(installationId?: string | null): string {
  return installationId ? "This connector account only" : "All connector accounts";
}

function publishedTime(version: ScopedVersionFields): number {
  return new Date(version.publishedAt ?? version.updatedAt).getTime();
}

// 0 = scoped to the selected account (wins at resolution), 1 = all accounts, 2 = another account.
function scopeRank(version: ScopedVersionFields, installationId?: string): number {
  if (installationId && version.installationId === installationId) {
    return 0;
  }
  return version.installationId ? 2 : 1;
}

export function pickActiveVersion<T extends ScopedVersionFields>(versions: T[], installationId?: string): T | null {
  const published = versions.filter((version) => version.lifecycleState === "published");
  if (published.length === 0) {
    return null;
  }
  return [...published].sort((left, right) => {
    const rankDelta = scopeRank(left, installationId) - scopeRank(right, installationId);
    return rankDelta !== 0 ? rankDelta : publishedTime(right) - publishedTime(left);
  })[0]!;
}
