import { IsOptional, IsString, MaxLength } from "class-validator";

export class ListErrorOccurrencesDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dateFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  limit?: string;
}
