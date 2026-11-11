import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateCartPreferencesDto {
  @IsOptional()
  @IsBoolean()
  giftWrap?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number;
}
