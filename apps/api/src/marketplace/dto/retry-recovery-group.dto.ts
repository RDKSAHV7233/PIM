import { IsString, MaxLength } from "class-validator";

export class RetryRecoveryGroupDto {
  @IsString()
  @MaxLength(100)
  errorFamily!: string;
}
