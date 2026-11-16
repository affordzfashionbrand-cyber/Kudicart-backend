import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ReorderItemEntryDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsInt()
  displayOrder: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ReorderItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemEntryDto)
  items: ReorderItemEntryDto[];
}

export class ReorderSectionEntryDto {
  @IsString()
  @IsNotEmpty()
  sectionKey: string;

  @IsInt()
  displayOrder: number;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class ReorderSectionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderSectionEntryDto)
  sections: ReorderSectionEntryDto[];
}
