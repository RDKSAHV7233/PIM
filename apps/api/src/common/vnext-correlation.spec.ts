import { createVnextCorrelationId } from "./vnext-correlation";

describe("createVnextCorrelationId", () => {
  it("creates a local vNext-prefixed UUID correlation id", () => {
    expect(createVnextCorrelationId()).toMatch(/^vnext_[0-9a-f-]{36}$/);
  });

  it("creates a new id for each attempt", () => {
    expect(createVnextCorrelationId()).not.toBe(createVnextCorrelationId());
  });
});
