import { ArrayMaxSize, IsArray, IsString, MaxLength } from "class-validator";

export class SuggestMappingDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  headers!: string[];
}
