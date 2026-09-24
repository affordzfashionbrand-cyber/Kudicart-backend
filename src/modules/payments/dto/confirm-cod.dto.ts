import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmCodDto {
  @IsNotEmpty({ message: 'orderId is required' })
  @IsString()
  orderId: string;
}
