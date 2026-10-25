import { IsNotEmpty, IsString, IsIn, Length, Matches } from 'class-validator';

export class UpdateVehicleDto {
  @IsNotEmpty({ message: 'Registration number is required' })
  @IsString()
  @Matches(
    /^([A-Z]{2}[\s\-]?[0-9]{1,2}[\s\-]?[A-Z]{0,3}[\s\-]?[0-9]{1,4}|[0-9]{2}[\s\-]?BH[\s\-]?[0-9]{4}[\s\-]?[A-Z]{1,2})$/i,
    {
      message: 'Enter a valid registration number (e.g. MH 01 AB 1234 or 22 BH 1234 AA)',
    },
  )
  registrationNumber: string;

  @IsNotEmpty({ message: 'Vehicle type is required' })
  @IsString()
  @IsIn(
    ['Bike', 'Scooty', 'EV Bike', 'EV Scooty', 'Electric Scooter', 'Scooter', 'Cycle', 'Other'],
    {
      message: 'Vehicle type must be Bike, Scooty, EV Bike, or EV Scooty',
    },
  )
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
