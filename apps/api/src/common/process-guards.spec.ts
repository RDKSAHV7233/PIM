import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { registerProcessGuards, runAndExitOnFailure } from "./process-guards";

describe("registerProcessGuards (prod-cert DEF-PC-013)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("handles unhandledRejection by logging, so the event no longer terminates the process", () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const fake = new EventEmitter();
    registerProcessGuards(fake as unknown as NodeJS.Process);

    expect(fake.listenerCount("unhandledRejection")).toBe(1);
    expect(() => fake.emit("unhandledRejection", Object.assign(new Error("pool timeout"), { code: "P2024" }))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("pool timeout"), expect.anything());
  });

  it("does not install an uncaughtException handler (Node's default exit is kept)", () => {
    const fake = new EventEmitter();
    registerProcessGuards(fake as unknown as NodeJS.Process);
    expect(fake.listenerCount("uncaughtException")).toBe(0);
  });

  it("logs non-Error rejection reasons too", () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const fake = new EventEmitter();
    registerProcessGuards(fake as unknown as NodeJS.Process);
    fake.emit("unhandledRejection", "plain string reason");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("plain string reason"), undefined);
  });

  it("logs the Prisma code and the stack so the failing task can be identified", () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const fake = new EventEmitter();
    registerProcessGuards(fake as unknown as NodeJS.Process);
    const err = Object.assign(new Error("pool timeout"), { code: "P2024" });
    fake.emit("unhandledRejection", err);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[P2024]"), expect.stringContaining("pool timeout"));
  });

  it("is idempotent: registering twice does not duplicate the listener", () => {
    const fake = new EventEmitter();
    registerProcessGuards(fake as unknown as NodeJS.Process);
    registerProcessGuards(fake as unknown as NodeJS.Process);
    expect(fake.listenerCount("unhandledRejection")).toBe(1);
  });
});

describe("runAndExitOnFailure (boot failures stay fatal)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("logs and exits with code 1 when startup rejects (bad env, port in use, DB init)", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const exit = jest.fn();
    runAndExitOnFailure(() => Promise.reject(new Error("EADDRINUSE: address already in use")), { exit } as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("API failed to start"), expect.anything());
  });

  it("does not exit when startup succeeds", async () => {
    const exit = jest.fn();
    runAndExitOnFailure(() => Promise.resolve(), { exit } as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).not.toHaveBeenCalled();
  });
});
