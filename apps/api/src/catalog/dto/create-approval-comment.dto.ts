import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateApprovalCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
