import { IsNotEmpty, IsString } from 'class-validator';

export class AssignDriverDto {
  @IsNotEmpty({ message: 'driverId is required' })
  @IsString()
  driverId: string;
}
