import { ArrayMaxSize, IsArray, IsString } from "class-validator";

export class SuggestMappingDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  headers!: string[];
}
