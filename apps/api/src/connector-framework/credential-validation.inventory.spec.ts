import "reflect-metadata";
import { ConnectorRegistry } from "./connector.registry";
import { BOOLEAN_FALSE_MEANS_REJECTION, LEGACY_PARKED_NO_DETAILED_VERIFIER } from "./credential-validation";

// Inventory guard for the heartbeat. The heartbeat trusts a connector's tri-state verifier;
// a connector with only the legacy boolean cannot tell an outage from a rejection. Every
// registered connector must therefore have a detailed verifier, be on the audited
// "boolean false means rejection" list, or be on the named parked list. Adding a connector
// without one of the three fails here instead of silently expiring customers' credentials.
//
// Keyed on the REGISTERED slug, not the directory name (amazon-in lives in amazon/,
// dynamics-365 in dynamics365/).

type ConnectorClass = { prototype: Record<string, unknown>; new (...args: never[]): { slug: string } };

function registeredConnectorClasses(): ConnectorClass[] {
  const paramTypes: unknown[] = Reflect.getMetadata("design:paramtypes", ConnectorRegistry) ?? [];
  return paramTypes.filter(
    (type): type is ConnectorClass =>
      typeof type === "function" && typeof (type as ConnectorClass).prototype?.validateCredentials === "function",
  );
}

function slugOf(connectorClass: ConnectorClass): string {
  // Class-field initializers assign `slug`; constructor dependencies are not needed for that.
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 ??= "pim1-test-encryption-key-v1-minimum-32";
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION ??= "1";
  // Some constructors touch a dependency (for example a startup warning on a logger), so every
  // constructor argument is a permissive stub: any property is a no-op function.
  const stub = new Proxy({}, { get: () => () => undefined });
  const args = new Array(10).fill(stub);
  return (Reflect.construct(connectorClass as never, args) as { slug: string }).slug;
}

describe("heartbeat verifier inventory", () => {
  const classes = registeredConnectorClasses();
  const entries = classes.map((connectorClass) => ({
    slug: slugOf(connectorClass),
    hasDetailed: typeof connectorClass.prototype.validateStoredCredentialsDetailed === "function",
  }));

  it("sees the registered connectors", () => {
    expect(entries.length).toBeGreaterThanOrEqual(15);
    expect(new Set(entries.map((e) => e.slug)).size).toBe(entries.length);
  });

  it("every registered connector has a detailed verifier, an audited boolean entry, or a parked entry", () => {
    const uncovered = entries
      .filter(
        (e) =>
          !e.hasDetailed && !BOOLEAN_FALSE_MEANS_REJECTION.has(e.slug) && !LEGACY_PARKED_NO_DETAILED_VERIFIER.has(e.slug),
      )
      .map((e) => e.slug);
    expect(uncovered).toEqual([]);
  });

  it("the parked list is exactly the connectors that still lack a detailed verifier (it cannot go stale)", () => {
    const lacking = entries
      .filter((e) => !e.hasDetailed)
      .map((e) => e.slug)
      .sort();
    expect([...LEGACY_PARKED_NO_DETAILED_VERIFIER].sort()).toEqual(lacking);
  });

  it("every allowlisted slug is a registered connector without a detailed verifier", () => {
    for (const slug of BOOLEAN_FALSE_MEANS_REJECTION) {
      const entry = entries.find((e) => e.slug === slug);
      expect(entry).toBeDefined();
      expect(entry?.hasDetailed).toBe(false);
    }
  });

  it("no connector qualifies for BOOLEAN_FALSE_MEANS_REJECTION today", () => {
    expect(BOOLEAN_FALSE_MEANS_REJECTION.size).toBe(0);
  });

  it("the twelve connectors with a tri-state verifier are accounted for by slug", () => {
    expect(
      entries
        .filter((e) => e.hasDetailed)
        .map((e) => e.slug)
        .sort(),
    ).toEqual([
      "amazon-in",
      "bigcommerce",
      "dynamics-365",
      "ebay",
      "etsy",
      "flipkart",
      "odoo",
      "prestashop",
      "shopify",
      "shopware",
      "woocommerce",
      "zoho-inventory",
    ]);
  });
});
