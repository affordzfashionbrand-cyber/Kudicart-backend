import { IsNotEmpty, IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';

export class CreateRazorpayOrderDto {
  @IsNotEmpty({ message: 'amount is required' })
  @IsNumber()
  @IsPositive({ message: 'amount must be a positive number' })
  amount: number;

  @IsOptional()
  @IsString()
  orderId?: string;
}
