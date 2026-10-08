// Which installed connector account a product page evaluates channel readiness against.
//
// Readiness resolves the mapping for one scope. A mapping published for a specific connector account is
// installation-scoped, and the API's resolver keeps such a version only when the evaluation names that
// installation; with no installation id it falls back to the slug-wide scope, matches nothing, and reports
// "using_system_default_mapping" even though a live account mapping exists (G1a). Every readiness call on the
// product page must therefore pass the same installation. Import-free so tests can execute it.

export function selectReadinessInstallation<T extends { slug: string }>(
  installedConnectors: readonly T[],
  connectorSlug: string,
  isReadyToPublish: (connector: T) => boolean,
): T | null {
  return installedConnectors.find((connector) => connector.slug === connectorSlug && isReadyToPublish(connector)) ?? null;
}
