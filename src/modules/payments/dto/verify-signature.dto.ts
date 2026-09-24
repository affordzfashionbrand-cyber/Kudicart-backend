import { IsNotEmpty, IsString } from 'class-validator';

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
}
