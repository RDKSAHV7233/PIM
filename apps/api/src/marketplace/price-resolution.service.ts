// apps/api/src/marketplace/price-resolution.service.ts
// Pure price-resolution helper: maps pre-fetched Prisma ProductPrice rows to the
// typed MarketPrice contract used by the connector payload.
//
// Design: no DB query here — the caller includes prices in the main product select.
// This keeps everything in one round-trip and makes the logic independently testable.

import { Injectable } from "@nestjs/common";
import { MarketPrice } from "../connector-framework/connector.interface";

/**
 * Shape of a ProductPrice row as returned by Prisma when included with
 * `include: { priceList: { select: { isDefault, market: { select: { code } }, currency: { select: { code } } } } }`.
 * Only the fields this service actually reads are typed.
 */
export type ResolvedPriceRow = {
  mrp: number | null;
  sellingPrice: number | null;
  priceList: {
    isDefault: boolean;
    market: { code: string };
    currency: { code: string };
  };
};

@Injectable()
export class PriceResolutionService {
  /**
   * Maps pre-fetched ProductPrice rows to typed MarketPrice entries.
   *
   * Ordering of the input array is preserved (callers should sort by isDefault DESC
   * so the default price appears first — that keeps `marketPrices[0]` predictable).
   */
  fromRows(rows: ResolvedPriceRow[]): MarketPrice[] {
    return rows.map((row) => ({
      marketCode: row.priceList.market.code,
      currencyCode: row.priceList.currency.code,
      mrp: row.mrp ?? undefined,
      sellingPrice: row.sellingPrice ?? undefined,
      isDefault: row.priceList.isDefault,
    }));
  }

  /**
   * Returns the first price where `isDefault === true`, or undefined if none.
   * Used to decide the top-level `mrp`/`sellingPrice` and `currencyCode` for
   * the connector payload.
   */
  findDefault(prices: MarketPrice[]): MarketPrice | undefined {
    return prices.find((p) => p.isDefault);
  }
}
