import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty({ description: "The user's current password for verification" })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  currentPassword!: string;

  @ApiProperty({ description: "The new password (minimum 8 characters)" })
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  newPassword!: string;
}
