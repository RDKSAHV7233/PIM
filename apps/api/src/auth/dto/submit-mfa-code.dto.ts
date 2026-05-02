import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";

export class SubmitMfaCodeDto {
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @Length(6, 32)
  code!: string;
}
