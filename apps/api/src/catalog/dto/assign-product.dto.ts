import { IsString, MaxLength, ValidateIf } from "class-validator";

export class AssignProductDto {
  @ValidateIf((o: AssignProductDto) => o.assigneeId !== null && o.assigneeId !== undefined)
  @IsString()
  @MaxLength(50)
  assigneeId?: string | null;
}
