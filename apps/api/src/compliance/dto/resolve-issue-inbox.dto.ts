import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from "class-validator";

export class ResolveIssueInboxDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  issueIds!: string[];
}
