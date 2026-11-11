import { IsOptional, IsString, IsInt } from 'class-validator';

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;
}
