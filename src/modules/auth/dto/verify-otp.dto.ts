import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @Matches(/^(\+?[0-9\s\-]{8,20})$/, {
    message: 'Phone number must be a valid phone number',
  })
  phoneNumber: string;

  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Length(4, 6, { message: 'OTP must be 4 to 6 digits' })
  otp: string;
}
