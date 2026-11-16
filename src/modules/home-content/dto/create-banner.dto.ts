import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  IsDateString,
  IsUrl,
} from 'class-validator';

export enum BannerPlacementEnum {
  HERO_CAROUSEL = 'HERO_CAROUSEL',
  EDITORIAL_STRIP = 'EDITORIAL_STRIP',
  MODERN_REDEFINED = 'MODERN_REDEFINED',
  PROMO_POPUP = 'PROMO_POPUP',
}

export enum DeepLinkActionTypeEnum {
  CATEGORY = 'CATEGORY',
  PRODUCT = 'PRODUCT',
  BRAND = 'BRAND',
  SEARCH_QUERY = 'SEARCH_QUERY',
  EXTERNAL_URL = 'EXTERNAL_URL',
  NONE = 'NONE',
}

export class CreateBannerDto {
  @IsEnum(BannerPlacementEnum)
  @IsOptional()
  placement?: BannerPlacementEnum = BannerPlacementEnum.HERO_CAROUSEL;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsString()
  @IsNotEmpty()
  title1: string;

  @IsString()
  @IsOptional()
  title2?: string;

  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsString()
  @IsOptional()
  mobileImageUrl?: string;

  @IsString()
  @IsOptional()
  targetGender?: string = 'All';

  @IsEnum(DeepLinkActionTypeEnum)
  @IsOptional()
  actionType?: DeepLinkActionTypeEnum = DeepLinkActionTypeEnum.CATEGORY;

  @IsString()
  @IsOptional()
  actionValue?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  productId?: string;

  @IsInt()
  @IsOptional()
  displayOrder?: number = 0;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
