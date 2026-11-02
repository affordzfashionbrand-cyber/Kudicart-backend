import { IsNotEmpty, IsString, IsOptional, IsBoolean, Matches, IsNumber } from 'class-validator';

export class CreateAddressDto {
  @IsNotEmpty({ message: 'Address label is required (e.g. Home, Work, Other)' })
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsNotEmpty({ message: 'Address line 1 is required' })
  @IsString()
  line1: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsNotEmpty({ message: 'Locality/Area is required' })
  @IsString()
  locality: string;

  @IsNotEmpty({ message: 'City is required' })
  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsNotEmpty({ message: '6-digit Indian PIN code is required' })
  @IsString()
  @Matches(/^[1-9][0-9]{5}$/, { message: 'Pincode must be a valid 6-digit Indian Postal Code' })
  pincode: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
