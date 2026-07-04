import { parseCapabilities } from "./parse-capabilities";

describe("parseCapabilities", () => {
  it("normalizes lowercase capabilities to uppercase", () => {
    expect(parseCapabilities(["publish", "validate", "status_sync"])).toEqual([
      "PUBLISH",
      "VALIDATE",
      "STATUS_SYNC",
    ]);
  });

  it("normalizes mixed-case capabilities", () => {
    expect(parseCapabilities(["Publish", "Status_Sync"])).toEqual([
      "PUBLISH",
      "STATUS_SYNC",
    ]);
  });

  it("preserves already-uppercase capabilities (Amazon/Flipkart pattern)", () => {
    expect(parseCapabilities(["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"])).toEqual([
      "PUBLISH",
      "VALIDATE",
      "STATUS_SYNC",
      "WEBHOOK_RECEIVE",
    ]);
  });

  it("parses Postgres TEXT[] format with uppercase", () => {
    expect(parseCapabilities("{PUBLISH,VALIDATE,STATUS_SYNC}")).toEqual([
      "PUBLISH",
      "VALIDATE",
      "STATUS_SYNC",
    ]);
  });

  it("parses Postgres TEXT[] format with lowercase and normalizes", () => {
    expect(parseCapabilities("{publish,catalog_sync,status_feedback}")).toEqual([
      "PUBLISH",
      "CATALOG_SYNC",
      "STATUS_FEEDBACK",
    ]);
  });

  it("parses Postgres TEXT[] format with quoted values", () => {
    expect(parseCapabilities('{"publish","VALIDATE","status_sync"}')).toEqual([
      "PUBLISH",
      "VALIDATE",
      "STATUS_SYNC",
    ]);
  });

  it("returns empty array for null/undefined/empty", () => {
    expect(parseCapabilities(null)).toEqual([]);
    expect(parseCapabilities(undefined)).toEqual([]);
    expect(parseCapabilities("")).toEqual([]);
    expect(parseCapabilities([])).toEqual([]);
  });

  it("filters non-string array elements", () => {
    expect(parseCapabilities([42, "PUBLISH", null, "validate"])).toEqual([
      "PUBLISH",
      "VALIDATE",
    ]);
  });

  it("unknown capabilities are normalized but not filtered", () => {
    const result = parseCapabilities(["publish", "unknown_cap"]);
    expect(result).toEqual(["PUBLISH", "UNKNOWN_CAP"]);
    expect(result).not.toContain("publish");
  });
});
