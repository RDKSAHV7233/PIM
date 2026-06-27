import { IsIn, IsOptional, IsString, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from "class-validator";

const CRON_FIELD_RANGES: Array<[number, number]> = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day of month
  [1, 12],  // month
  [0, 7],   // day of week (0 and 7 = Sunday)
];

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const base = stepMatch ? stepMatch[1] : part;
    if (stepMatch) {
      const step = Number(stepMatch[2]);
      if (!Number.isInteger(step) || step < 1) return false;
    }
    if (base === "*") continue;
    const rangeMatch = base.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      if (lo < min || hi > max || lo > hi) return false;
      continue;
    }
    const n = Number(base);
    if (!Number.isInteger(n) || n < min || n > max) return false;
  }
  return true;
}

@ValidatorConstraint({ name: "cronExpression", async: false })
class CronExpressionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const fields = value.trim().split(/\s+/);
    if (fields.length < 5 || fields.length > 6) return false;
    const checkFields = fields.length === 6 ? fields.slice(1) : fields;
    return checkFields.every((field, i) => isValidCronField(field, CRON_FIELD_RANGES[i][0], CRON_FIELD_RANGES[i][1]));
  }

  defaultMessage(_args: ValidationArguments): string {
    return "cronExpression must be a valid 5 or 6-field cron expression with values in range.";
  }
}

export class UpsertScheduleDto {
  @IsString()
  @MaxLength(100)
  @Validate(CronExpressionConstraint)
  cronExpression!: string;

  @IsOptional()
  @IsIn(["approved_only", "all"])
  scope?: string;

  @IsOptional()
  @IsIn(["active", "paused"])
  status?: string;
}
