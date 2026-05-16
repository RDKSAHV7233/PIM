import { IsOptional, IsString, MaxLength } from "class-validator";

export class ConfigureConnectorDto {
  /** Amazon SP-API marketplace ID — e.g. "A21TJRUUN4KGV" for India. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  marketplaceId?: string;

  /** Default Amazon product type — e.g. "SHIRT". Upcased before storage. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultProductType?: string;
}
