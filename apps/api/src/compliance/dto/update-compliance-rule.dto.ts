import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const SEVERITIES = ["error", "warning"] as const;
const RULE_TYPES = ["required_field", "regex_field", "value_in_set"] as const;

export class UpdateComplianceRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryId?: string;

  @IsIn(SEVERITIES)
  severity!: (typeof SEVERITIES)[number];

  @IsIn(RULE_TYPES)
  ruleType!: (typeof RULE_TYPES)[number];

  @IsObject()
  config!: Record<string, unknown>;

  @IsBoolean()
  active!: boolean;
}
