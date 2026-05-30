import type { ConnectorCap } from "./connector.interface";
import { resolveConnectorLaunchPolicy } from "./connector-launch-policy";

describe("resolveConnectorLaunchPolicy", () => {
  const allCaps: ConnectorCap[] = ["VALIDATE", "PUBLISH", "STATUS_SYNC", "WEBHOOK_RECEIVE", "EXCEL_EXPORT"];

  describe("amazon-in", () => {
    it("is live", () => {
      const policy = resolveConnectorLaunchPolicy("amazon-in", allCaps);
      expect(policy.launchStage).toBe("live");
    });

    it("surfaces all capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("amazon-in", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });
  });

  describe("shopify", () => {
    it("is live", () => {
      const policy = resolveConnectorLaunchPolicy("shopify", allCaps);
      expect(policy.launchStage).toBe("live");
    });

    it("surfaces all capabilities", () => {
      const policy = resolveConnectorLaunchPolicy("shopify", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });
  });

  describe("meesho", () => {
    it("is manual (export-only; not self-serve)", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.launchStage).toBe("manual");
    });

    it("surfaces all capabilities in manual stage", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });

    it("launchNote describes export-only model and RD-MEESHO-1 blocker", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.launchNote).toMatch(/export/i);
      expect(policy.launchNote).toMatch(/RD-MEESHO-1/);
    });

    it("is case-insensitive for slug", () => {
      const policy = resolveConnectorLaunchPolicy("MEESHO", allCaps);
      expect(policy.launchStage).toBe("manual");
    });
  });

  describe("unknown slug", () => {
    it("defaults to live", () => {
      const policy = resolveConnectorLaunchPolicy("some-future-connector", allCaps);
      expect(policy.launchStage).toBe("live");
    });

    it("surfaces all capabilities for unknown slugs", () => {
      const policy = resolveConnectorLaunchPolicy("some-future-connector", allCaps);
      expect(policy.surfacedCapabilities).toEqual(allCaps);
    });

    it("has null launchNote", () => {
      const policy = resolveConnectorLaunchPolicy("some-future-connector", allCaps);
      expect(policy.launchNote).toBeNull();
    });
  });

  describe("flipkart (no explicit policy — falls through to default live)", () => {
    it("is live", () => {
      const policy = resolveConnectorLaunchPolicy("flipkart", allCaps);
      expect(policy.launchStage).toBe("live");
    });
  });
});
