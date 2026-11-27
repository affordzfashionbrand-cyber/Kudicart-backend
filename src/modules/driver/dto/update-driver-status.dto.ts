import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateDriverStatusDto {
  @IsNotEmpty({ message: 'isOnline status is required' })
  @IsBoolean()
  isOnline: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'GPS latitude must be a valid number' })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({}, { message: 'GPS longitude must be a valid number' })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsNumber({}, { message: 'GPS accuracy must be a valid number' })
  @Min(0)
  accuracy?: number;
}
