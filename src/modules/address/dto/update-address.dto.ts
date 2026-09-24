import { IsOptional, IsString, IsBoolean, Matches } from 'class-validator';

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  line1?: string;

  @IsOptional()
  @IsString()
  locality?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]{5}$/, { message: 'Pincode must be a 6-digit Indian Postal Code' })
  pincode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
