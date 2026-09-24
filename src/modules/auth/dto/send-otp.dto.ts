import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SendOtpDto {
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @Matches(/^(\+?[0-9\s\-]{8,20})$/, {
    message: 'Phone number must be a valid phone number (e.g. +91 98450 12890)',
  })
  phoneNumber: string;
}
