import { IsNotEmpty, IsString, IsOptional, IsInt, Min } from 'class-validator';

export class AddCartItemDto {
  @IsNotEmpty({ message: 'productId is required' })
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity?: number;
}
