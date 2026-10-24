import { IsNotEmpty, IsString, IsIn, Length, Matches } from 'class-validator';

export class UpdateVehicleDto {
  @IsNotEmpty({ message: 'Registration number is required' })
  @IsString()
  @Matches(/^[A-Z]{2}[0-9\sA-Z]{6,12}$/i, {
    message: 'Valid Indian vehicle registration number required (e.g., KA 05 MJ 4821)',
  })
  registrationNumber: string;

  @IsNotEmpty({ message: 'Vehicle type is required' })
  @IsString()
  @IsIn(['Bike', 'Electric Scooter', 'Scooter', 'Cycle', 'Other'], {
    message: 'Vehicle type must be Bike, Electric Scooter, Scooter, Cycle, or Other',
  })
  vehicleType: string;

  @IsNotEmpty({ message: 'Vehicle make is required' })
  @IsString()
  @Length(2, 50, { message: 'Make must be between 2 and 50 characters' })
  make: string;

  @IsNotEmpty({ message: 'Vehicle model is required' })
  @IsString()
  @Length(1, 50, { message: 'Model must be between 1 and 50 characters' })
  model: string;
}
