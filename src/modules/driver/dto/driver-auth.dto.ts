import { IsNotEmpty, IsString, Matches, IsOptional } from 'class-validator';

export class DriverSendOtpDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
  })
  phone?: string;
}

export class DriverVerifyOtpDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\+?91[\-\s]?)?[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
  })
  phone?: string;

  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'OTP must consist of 6 numeric digits',
  })
  otp: string;
}
