import { IsNotEmpty, IsNumber, IsOptional, Min, Max } from 'class-validator';

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
}
