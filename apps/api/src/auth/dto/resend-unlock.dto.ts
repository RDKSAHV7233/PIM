import { IsString } from "class-validator";

export class ResendUnlockDto {
  @IsString()
  email!: string;

  @IsString()
  workspaceSlug!: string;
}
