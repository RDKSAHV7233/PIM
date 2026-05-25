import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from "class-validator";

export class ResolveIssueInboxDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  issueIds!: string[];
}
