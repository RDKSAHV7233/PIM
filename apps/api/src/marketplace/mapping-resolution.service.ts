// apps/api/src/marketplace/mapping-resolution.service.ts
//
// Story 2 of the Shopify shadow-sprint restart: a narrow, connector-oriented
// boundary in front of the existing Shopify mapping authority
// (MarketplaceService.getEffectiveMapping — the same 4-tier precedence used by
// the real publish path via applyMappedConnectorTargets). This introduces NO
// new resolution logic, NO new mapping engine, and does not touch
// buildConnectorProductPayload/applyMappedConnectorTargets or any remote
// mutation path. It exists purely so later shadow-sprint stories (non-mutating
// shadow execution, legacy/vNext comparator) can depend on a small,
// connector-slug-driven surface instead of reaching into MarketplaceService's
// full 2000+ line API.
//
// Parity is the whole point of this class: resolveForConnector("shopify", ...)
// must always return exactly what getEffectiveMapping("shopify", ...) already
// returns today — see mapping-resolution.service.spec.ts's parity tests.

import { Injectable } from "@nestjs/common";
import { MarketplaceService, EffectiveMapping } from "./marketplace.service";
import { mapConnectorSlugToMarketplaceChannel } from "./marketplace-channels";

export type ResolvedConnectorMapping = {
  connectorSlug: string;
  requiredFields: string[];
  fieldMap: Record<string, string | string[]>;
  rawFieldMap?: Record<string, unknown>;
  source: EffectiveMapping["source"];
};

@Injectable()
export class MappingResolutionService {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  /**
   * Resolves the same mapping a connector's real publish path already
   * resolves via MarketplaceService.getEffectiveMapping — no duplicated
   * precedence rules, no independent lookup.
   *
   * @param connectorSlug e.g. "shopify" — mapped to its marketplace channel
   *   via mapConnectorSlugToMarketplaceChannel, the same helper
   *   applyMappedConnectorTargets already uses for this purpose.
   * @param categoryId category scope for the mapping lookup.
   * @param installationId optional installation-scoped override.
   */
  async resolveForConnector(
    connectorSlug: string,
    categoryId: string,
    installationId?: string | null,
  ): Promise<ResolvedConnectorMapping> {
    const channel = mapConnectorSlugToMarketplaceChannel(connectorSlug);
    if (!channel) {
      throw new Error(`No marketplace channel mapping exists for connector slug "${connectorSlug}".`);
    }
    const effective = await this.marketplaceService.getEffectiveMapping(
      channel,
      categoryId,
      undefined,
      installationId ?? null,
    );
    return {
      connectorSlug,
      requiredFields: effective.requiredFields,
      fieldMap: effective.fieldMap,
      rawFieldMap: effective.rawFieldMap,
      source: effective.source,
    };
  }
}
