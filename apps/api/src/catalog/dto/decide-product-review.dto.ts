import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const REVIEW_DECISIONS = ["approved", "rejected"] as const;

export class DecideProductReviewDto {
  @IsIn(REVIEW_DECISIONS)
  status!: (typeof REVIEW_DECISIONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
