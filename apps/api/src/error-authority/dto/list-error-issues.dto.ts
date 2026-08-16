import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const ERROR_AUTHORITY_RUNTIMES = ["api", "worker", "next_server", "browser"] as const;
export const ERROR_AUTHORITY_SEVERITIES = ["p0", "p1", "p2", "p3"] as const;
export const ERROR_AUTHORITY_STATES = ["open", "muted", "resolved"] as const;

export class ListErrorIssuesDto {
  @IsOptional()
  @IsIn(ERROR_AUTHORITY_RUNTIMES)
  runtime?: (typeof ERROR_AUTHORITY_RUNTIMES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  service?: string;

  @IsOptional()
  @IsIn(ERROR_AUTHORITY_SEVERITIES)
  severity?: (typeof ERROR_AUTHORITY_SEVERITIES)[number];

  @IsOptional()
  @IsIn(ERROR_AUTHORITY_STATES)
  state?: (typeof ERROR_AUTHORITY_STATES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  release?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  errorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  route?: string;

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
