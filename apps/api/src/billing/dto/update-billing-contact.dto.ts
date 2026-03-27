import { Transform } from "class-transformer";
import { IsEmail, IsOptional } from "class-validator";

export class UpdateBillingContactDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  })
  @IsEmail()
  billingContactEmail?: string | null;
}
