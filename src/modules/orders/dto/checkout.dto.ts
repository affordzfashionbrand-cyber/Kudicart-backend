import { IsNotEmpty, IsString, IsIn, IsOptional, IsBoolean } from 'class-validator';

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
}
