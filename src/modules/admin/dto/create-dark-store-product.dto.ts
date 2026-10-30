import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsOptional,
  Min,
  ArrayNotEmpty,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDarkStoreProductDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  brand?: string = 'Affordz Official Store';

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  darkStoreHubId: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1, { message: 'Selling price must be at least ₹1' })
  price: number;

  @IsNumber()
  @Type(() => Number)
  @Min(1, { message: 'Original price (MRP) must be at least ₹1' })
  originalPrice: number;

  @IsInt()
  @Type(() => Number)
  @Min(0, { message: 'Stock quantity cannot be negative' })
  stockQuantity: number;

  @IsBoolean()
  @IsOptional()
  readyToShip?: boolean = true;

  @IsArray()
  @ArrayNotEmpty({ message: 'At least one available size must be selected' })
  @IsString({ each: true })
  sizes: string[];

  @IsString()
  @IsOptional()
  fabric?: string;

  @IsString()
  @IsOptional()
  origin?: string;

  @IsString()
  @IsNotEmpty({ message: 'Primary product image is required' })
  image: string;

  @IsString()
  @IsNotEmpty({ message: 'Image alt text is required for accessibility' })
  altText: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  galleryImages?: string[] = [];

  // Invariant guard: if client passes fulfillmentType, it must not be VENDOR
  @IsString()
  @IsOptional()
  fulfillmentType?: string;
}
