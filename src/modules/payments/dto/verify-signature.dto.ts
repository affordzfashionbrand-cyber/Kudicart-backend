import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class VerifySignatureDto {
  @IsNotEmpty({ message: 'orderId is required' })
  @IsString()
  orderId: string;

  @IsNotEmpty({ message: 'paymentId is required' })
  @IsString()
  paymentId: string;

  @IsNotEmpty({ message: 'signature is required' })
  @IsString()
  signature: string;

  @IsOptional()
  @IsString()
  razorpayOrderId?: string;
}
