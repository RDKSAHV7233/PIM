import { IsString } from "class-validator";

export class SetUserPasswordDto {
  @IsString()
  password!: string;
}
