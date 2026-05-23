import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import {
  STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
  STEP_UP_SCOPE_MAPPING_HIGH_RISK,
  StepUpScope,
} from "../jwt";

export class StepUpChallengeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;

  @IsIn([STEP_UP_SCOPE_MAPPING_HIGH_RISK, STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK])
  scope!: StepUpScope;
}
