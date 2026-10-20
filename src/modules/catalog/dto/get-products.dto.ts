import { IsOptional, IsString } from 'class-validator';

export class GetProductsDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sort?: 'price_asc' | 'price_desc' | 'rating' | 'popular' | 'newest';

  @IsOptional()
  @IsString()
  sortBy?: 'price_asc' | 'price_desc' | 'rating' | 'popular' | 'newest';

  @IsOptional()
  @IsString()
  fulfillmentType?: 'DARK_STORE' | 'VENDOR';

  @IsOptional()
  @IsString()
  tryAndBuyOnly?: string;

  @IsOptional()
  minPrice?: string | number;

  @IsOptional()
  maxPrice?: string | number;

  @IsOptional()
  page?: string | number;

  @IsOptional()
  limit?: string | number;
}
