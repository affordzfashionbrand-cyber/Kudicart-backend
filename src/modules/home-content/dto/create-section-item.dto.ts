import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { DeepLinkActionTypeEnum } from './create-banner.dto';

export class CreateSectionItemDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  @IsOptional()
  badge?: string;

  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsString()
  @IsOptional()
  accentColor?: string;

  @IsEnum(DeepLinkActionTypeEnum)
  @IsOptional()
  actionType?: DeepLinkActionTypeEnum = DeepLinkActionTypeEnum.CATEGORY;

  @IsString()
  @IsOptional()
  actionValue?: string;

  @IsInt()
  @IsOptional()
  displayOrder?: number = 0;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;
}

export class UpdateSectionItemDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  subtitle?: string;

  @IsString()
  @IsOptional()
  badge?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  accentColor?: string;

  @IsEnum(DeepLinkActionTypeEnum)
  @IsOptional()
  actionType?: DeepLinkActionTypeEnum;

  @IsString()
  @IsOptional()
  actionValue?: string;

  @IsInt()
  @IsOptional()
  displayOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
