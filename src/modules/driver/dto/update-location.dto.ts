import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class UpdateLocationDto {
  @IsNotEmpty({ message: 'latitude is required' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNotEmpty({ message: 'longitude is required' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  timestamp?: number;

  @IsOptional()
  @IsString()
  orderId?: string;
}
