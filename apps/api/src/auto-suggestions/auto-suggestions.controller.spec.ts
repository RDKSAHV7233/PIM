// QA-AI-01 (#1236): persisting a repair writes the product directly, so it is available only while the internal AI Lab flag is
// explicitly on. Fail-closed: unset, empty, false and malformed values all mean DISABLED. The dry run and the read suggestions
// are not gated here (they are part of the scoped API contract and have their own access-policy tests).

import { NotFoundException } from "@nestjs/common";
import { AutoSuggestionsController } from "./auto-suggestions.controller";
import { INTERNAL_AI_LAB_FLAG_ENV, isInternalAiLabEnabled } from "./internal-ai-lab-flag";

const request = { pimUserId: "u1", pimRole: "admin", pimTenant: "tenant-a", pimEffectiveRoles: ["admin"] } as never;

function createController() {
  const applyRepair = jest.fn().mockResolvedValue({ productId: "p1", apply: true });
  const service = { applyRepair } as never;
  return { controller: new AutoSuggestionsController(service), applyRepair };
}

describe("internal AI Lab flag", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["0", false],
    ["yes", false],
    ["1", false],
    ["truee", false],
    ["tru e", false],
    ["true", true],
    [" TRUE ", true],
    ["True", true],
  ])("value %p enables = %p", (value, expected) => {
    const env = value === undefined ? {} : { [INTERNAL_AI_LAB_FLAG_ENV]: value };
    expect(isInternalAiLabEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});

describe("AutoSuggestionsController.applyRepair gate", () => {
  const original = process.env[INTERNAL_AI_LAB_FLAG_ENV];
  afterEach(() => {
    if (original === undefined) {
      delete process.env[INTERNAL_AI_LAB_FLAG_ENV];
    } else {
      process.env[INTERNAL_AI_LAB_FLAG_ENV] = original;
    }
  });

  it.each([undefined, "", "false", "garbage"])("flag %p: apply=true is refused with 404 FEATURE_DISABLED and the service is never called", async (value) => {
    if (value === undefined) {
      delete process.env[INTERNAL_AI_LAB_FLAG_ENV];
    } else {
      process.env[INTERNAL_AI_LAB_FLAG_ENV] = value;
    }
    const { controller, applyRepair } = createController();
    let error: unknown;
    try {
      await controller.applyRepair("p1", { apply: true }, request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({ code: "FEATURE_DISABLED" });
    expect(applyRepair).not.toHaveBeenCalled();
  });

  it("a truthy non-boolean apply (the service's own coercion) is also refused while the flag is off", async () => {
    delete process.env[INTERNAL_AI_LAB_FLAG_ENV];
    const { controller, applyRepair } = createController();
    // The method is not async, so the gate throws synchronously; Nest turns either form into the same 404.
    expect(() => controller.applyRepair("p1", { apply: "false" as never }, request)).toThrow(NotFoundException);
    expect(applyRepair).not.toHaveBeenCalled();
  });

  it("the dry run (apply=false, or no body) still reaches the service while the flag is off", async () => {
    delete process.env[INTERNAL_AI_LAB_FLAG_ENV];
    const { controller, applyRepair } = createController();
    await controller.applyRepair("p1", { apply: false }, request);
    await controller.applyRepair("p1", undefined as never, request);
    expect(applyRepair).toHaveBeenCalledTimes(2);
    expect(applyRepair).toHaveBeenNthCalledWith(1, "p1", false, expect.any(Object));
    expect(applyRepair).toHaveBeenNthCalledWith(2, "p1", false, expect.any(Object));
  });

  it("positive case: with the flag explicitly on, apply=true reaches the service exactly once", async () => {
    process.env[INTERNAL_AI_LAB_FLAG_ENV] = "true";
    const { controller, applyRepair } = createController();
    await controller.applyRepair("p1", { apply: true }, request);
    expect(applyRepair).toHaveBeenCalledTimes(1);
    expect(applyRepair).toHaveBeenCalledWith("p1", true, expect.any(Object));
  });
});
