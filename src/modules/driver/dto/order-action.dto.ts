import { IsOptional, IsArray, IsString, IsBoolean } from 'class-validator';

export class OrderPickupDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  packageImages?: string[];
}

export class OrderDeliverDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliveryImages?: string[];

  @IsOptional()
  @IsBoolean()
  cashCollected?: boolean;
}
