import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ApiRuntimeProofController } from "./api-runtime-proof.controller";

const fakeRequest = {} as never;

describe("ApiRuntimeProofController", () => {
  const controller = new ApiRuntimeProofController();

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.ERROR_AUTHORITY_ENABLED;
    delete process.env.ERROR_AUTHORITY_INGEST_TOKEN;
  });

  it("returns 404 when ERROR_AUTHORITY_ENABLED is not true", async () => {
    process.env.APP_ENV = "staging";
    process.env.ERROR_AUTHORITY_ENABLED = "false";
    await expect(controller.triggerApiRuntimeProof("token", fakeRequest)).rejects.toThrow(NotFoundException);
  });

  it("returns 404 when APP_ENV is production", async () => {
    process.env.APP_ENV = "production";
    process.env.ERROR_AUTHORITY_ENABLED = "true";
    await expect(controller.triggerApiRuntimeProof("token", fakeRequest)).rejects.toThrow(NotFoundException);
  });

  it("throws unauthorized when ingest token is wrong", async () => {
    process.env.APP_ENV = "staging";
    process.env.ERROR_AUTHORITY_ENABLED = "true";
    process.env.ERROR_AUTHORITY_INGEST_TOKEN = "correct-token";
    await expect(controller.triggerApiRuntimeProof("wrong-token", fakeRequest)).rejects.toThrow(UnauthorizedException);
  });

  it("throws a plain Error captured by the global filter when token matches", async () => {
    process.env.APP_ENV = "staging";
    process.env.ERROR_AUTHORITY_ENABLED = "true";
    process.env.ERROR_AUTHORITY_INGEST_TOKEN = "correct-token";
    try {
      await controller.triggerApiRuntimeProof("correct-token", fakeRequest);
      fail("expected an error to be thrown");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("ERR_920_API_RUNTIME_PROOF");
      expect((error as Error).name).toBe("Err920ApiRuntimeProof");
    }
  });

  it("returns 404 in development environment (staging-only gate)", async () => {
    process.env.APP_ENV = "development";
    process.env.ERROR_AUTHORITY_ENABLED = "true";
    process.env.ERROR_AUTHORITY_INGEST_TOKEN = "dev-token";
    await expect(controller.triggerApiRuntimeProof("dev-token", fakeRequest)).rejects.toThrow(NotFoundException);
  });
});
