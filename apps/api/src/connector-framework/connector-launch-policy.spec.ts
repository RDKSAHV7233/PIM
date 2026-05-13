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
    it("is planned (hidden from operator UI)", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.launchStage).toBe("planned");
    });

    it("surfaces no capabilities while planned", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.surfacedCapabilities).toHaveLength(0);
    });

    it("launchNote references P5-S4 completion gate", () => {
      const policy = resolveConnectorLaunchPolicy("meesho", allCaps);
      expect(policy.launchNote).toMatch(/P5-S4/);
    });

    it("is case-insensitive for slug", () => {
      const policy = resolveConnectorLaunchPolicy("MEESHO", allCaps);
      expect(policy.launchStage).toBe("planned");
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
