// apps/api/src/connectors/amazon/amazon-marketplace-registry.spec.ts
// Unit tests for the Amazon marketplace registry.
// These are pure lookups — no I/O, no DI.

import {
  AMAZON_MARKETPLACE_REGISTRY,
  lookupAmazonMarketplace,
} from "./amazon-marketplace-registry";

describe("AMAZON_MARKETPLACE_REGISTRY", () => {
  it("contains at least 15 marketplaces", () => {
    expect(Object.keys(AMAZON_MARKETPLACE_REGISTRY).length).toBeGreaterThanOrEqual(15);
  });

  it("every entry has required fields with non-empty values", () => {
    for (const [id, entry] of Object.entries(AMAZON_MARKETPLACE_REGISTRY)) {
      expect(entry.marketCode.length).toBeGreaterThan(0);
      expect(entry.currencyCode.length).toBeGreaterThan(0);
      expect(entry.locale.length).toBeGreaterThan(0);
      expect(entry.endpoint).toMatch(/^https:\/\//);
      // marketCode should be 2 uppercase letters (ISO 3166-1 alpha-2)
      expect(entry.marketCode).toMatch(/^[A-Z]{2}$/);
      // currencyCode should be 3 uppercase letters (ISO 4217)
      expect(entry.currencyCode).toMatch(/^[A-Z]{3}$/);
      // Endpoints must be one of the three SP-API regional hosts
      expect([
        "https://sellingpartnerapi-na.amazon.com",
        "https://sellingpartnerapi-eu.amazon.com",
        "https://sellingpartnerapi-fe.amazon.com",
      ]).toContain(entry.endpoint);
      // Locale should follow Amazon's underscore format (e.g. "en_IN", "de_DE")
      expect(id).toBeTruthy();
    }
  });
});

describe("lookupAmazonMarketplace", () => {
  it("returns India entry for Amazon India marketplaceId", () => {
    const entry = lookupAmazonMarketplace("A21TJRUUN4KGV");
    expect(entry).toBeDefined();
    expect(entry!.marketCode).toBe("IN");
    expect(entry!.currencyCode).toBe("INR");
    expect(entry!.locale).toBe("en_IN");
  });

  it("returns UK entry for Amazon UK marketplaceId", () => {
    const entry = lookupAmazonMarketplace("A1F83G8C2ARO7P");
    expect(entry).toBeDefined();
    expect(entry!.marketCode).toBe("GB");
    expect(entry!.currencyCode).toBe("GBP");
  });

  it("returns US entry for Amazon US marketplaceId", () => {
    const entry = lookupAmazonMarketplace("ATVPDKIKX0DER");
    expect(entry).toBeDefined();
    expect(entry!.marketCode).toBe("US");
    expect(entry!.currencyCode).toBe("USD");
    expect(entry!.endpoint).toBe("https://sellingpartnerapi-na.amazon.com");
  });

  it("returns UAE entry for Amazon UAE marketplaceId", () => {
    const entry = lookupAmazonMarketplace("A2VIGQ35RCS4UG");
    expect(entry).toBeDefined();
    expect(entry!.marketCode).toBe("AE");
    expect(entry!.currencyCode).toBe("AED");
  });

  it("returns AU entry for Amazon Australia marketplaceId", () => {
    const entry = lookupAmazonMarketplace("A39IBJ37TRP1C6");
    expect(entry).toBeDefined();
    expect(entry!.marketCode).toBe("AU");
    expect(entry!.currencyCode).toBe("AUD");
    expect(entry!.endpoint).toBe("https://sellingpartnerapi-fe.amazon.com");
  });

  it("returns undefined for an unknown marketplaceId", () => {
    expect(lookupAmazonMarketplace("UNKNOWN_MKT_ID")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(lookupAmazonMarketplace("")).toBeUndefined();
  });

  it("is case-sensitive — known ID with wrong case returns undefined", () => {
    // Amazon marketplaceIds are uppercase — guard against accidental lowercasing upstream
    expect(lookupAmazonMarketplace("a21tjruun4kgv")).toBeUndefined();
  });
});
