import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
  IsArray,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  trialSize?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;
}

export class CheckoutDto {
  @IsNotEmpty({ message: 'addressId is required' })
  @IsString()
  addressId: string;

  @IsNotEmpty({ message: 'paymentMethod is required' })
  @IsIn(['RAZORPAY', 'COD'], { message: 'paymentMethod must be RAZORPAY or COD' })
  paymentMethod: 'RAZORPAY' | 'COD';

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsBoolean()
  isTryAndBuy?: boolean;

  @IsOptional()
  @IsBoolean()
  isBuyNow?: boolean;

  @IsOptional()
  @IsString()
  deliveryInstructions?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutItemDto)
  buyNowItem?: CheckoutItemDto;

  @IsOptional()
  @IsBoolean()
  giftWrap?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number;

  @IsOptional()
  @IsArray()
  items?: any[];

  @IsOptional()
  @IsNumber()
  itemTotal?: number;

  @IsOptional()
  @IsNumber()
  deliveryFee?: number;

  @IsOptional()
  @IsNumber()
  taxes?: number;

  @IsOptional()
  @IsNumber()
  grandTotal?: number;
}
