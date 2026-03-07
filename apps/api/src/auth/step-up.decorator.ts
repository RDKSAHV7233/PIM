import { SetMetadata } from "@nestjs/common";
import { StepUpScope } from "./jwt";

export interface StepUpRequirement {
  scope: StepUpScope;
  action: string;
}

export const STEP_UP_REQUIRED_KEY = "pim_step_up_required";

export const RequireStepUp = (scope: StepUpScope, action: string) =>
  SetMetadata(STEP_UP_REQUIRED_KEY, { scope, action } satisfies StepUpRequirement);
