import { IsNotEmpty, IsString, IsOptional, IsBoolean, Matches } from 'class-validator';

export class CreateAddressDto {
  @IsNotEmpty({ message: 'Address label is required (e.g. Home, Work, Boutique)' })
  @IsString()
  label: string;

  @IsNotEmpty({ message: 'Address line 1 is required' })
  @IsString()
  line1: string;

  @IsNotEmpty({ message: 'Locality/Area is required' })
  @IsString()
  locality: string;

  @IsNotEmpty({ message: 'City is required' })
  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]{5}$/, { message: 'Pincode must be a 6-digit Indian Postal Code' })
  pincode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
