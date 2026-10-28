import { IsOptional, IsString } from 'class-validator';

export class SearchSuggestionsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  limit?: string | number;
}
