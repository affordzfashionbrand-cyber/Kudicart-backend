import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateDriverStatusDto {
  @IsNotEmpty({ message: 'isOnline status is required' })
  @IsBoolean()
  isOnline: boolean;
}
