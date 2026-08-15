// Focused coverage for the new connector-credentials step-up scope added with
// the connector credentials-edit feature. No jwt.spec.ts or step-up.guard.spec.ts
// existed prior to this change (StepUpGuard's own logic — scope/session/revocation
// checks — is exercised generically regardless of which scope string is used, see
// step-up.guard.ts), so this proves the new scope specifically: it round-trips
// through sign/verify real end-to-end, and the issuance-side DTO allowlist accepts
// it, not just "the guard code compiles."

import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import {
  STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK,
  STEP_UP_SCOPE_MAPPING_HIGH_RISK,
  signPimJwt,
  verifyPimJwt,
} from "./jwt";
import { StepUpChallengeDto } from "./dto/step-up.dto";

describe("STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-for-hkdf-derive";
  });

  it("issuance: StepUpChallengeDto accepts the new scope", async () => {
    const dto = plainToInstance(StepUpChallengeDto, {
      password: "correct horse battery staple",
      scope: STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("issuance: StepUpChallengeDto still rejects an unknown scope string", async () => {
    const dto = plainToInstance(StepUpChallengeDto, {
      password: "correct horse battery staple",
      scope: "not_a_real_scope",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "scope")).toBe(true);
  });

  it("round-trips through a real step-up token: sign, then verify recovers the exact scope", () => {
    const accessToken = signPimJwt({ sub: "user-1", tenantId: "tenant-1", tokenType: "access" });
    const accessClaims = verifyPimJwt(accessToken)!;

    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "tenant-1",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK,
      parentJti: accessClaims.jti,
    });

    const stepUpClaims = verifyPimJwt(stepUpToken);
    expect(stepUpClaims).not.toBeNull();
    expect(stepUpClaims!.tokenType).toBe("step_up");
    expect(stepUpClaims!.stepUpScope).toBe(STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK);
    expect(stepUpClaims!.parentJti).toBe(accessClaims.jti);
  });

  it("a step-up token minted for the mapping scope does not decode as the connector-credentials scope", () => {
    const accessToken = signPimJwt({ sub: "user-1", tenantId: "tenant-1", tokenType: "access" });
    const accessClaims = verifyPimJwt(accessToken)!;

    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "tenant-1",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_MAPPING_HIGH_RISK,
      parentJti: accessClaims.jti,
    });

    const stepUpClaims = verifyPimJwt(stepUpToken);
    expect(stepUpClaims!.stepUpScope).not.toBe(STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK);
  });
});
