import { IsString, MaxLength } from "class-validator";

export class RequestChangesDto {
  @IsString()
  @MaxLength(2000)
  reason!: string;
}
