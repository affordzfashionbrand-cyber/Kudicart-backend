import { IsNotEmpty, IsString, Matches, IsOptional } from 'class-validator';

export class DriverSendOtpDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid mobile number',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid mobile number',
  })
  phone?: string;
}

export class DriverVerifyOtpDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid mobile number',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid mobile number',
  })
  phone?: string;

  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'OTP must consist of 4 to 6 numeric digits',
  })
  otp: string;
}
