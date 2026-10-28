import { IsNotEmpty, IsString, IsIn, IsOptional, IsBoolean, IsArray, IsNumber } from 'class-validator';

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
