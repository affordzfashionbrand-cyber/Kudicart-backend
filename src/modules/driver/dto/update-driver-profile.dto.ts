import { IsOptional, IsString, IsIn, Matches, Length } from 'class-validator';

export class UpdateDriverProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 60, { message: 'Full name must be between 2 and 60 characters' })
  fullName?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  vehicle?: string;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9\s]{12,16}$/, {
    message: 'Aadhaar number must contain 12 digits',
  })
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i, {
    message: 'PAN number must be in standard format (e.g. ABCDE1234F)',
  })
  panNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/, {
    message: 'Date of birth must be formatted as DD/MM/YYYY',
  })
  dob?: string;

  @IsOptional()
  @IsString()
  @Length(6, 30, { message: 'Driving licence number must be between 6 and 30 characters' })
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  @IsIn(['FULL_TIME', 'PART_TIME', ''], {
    message: 'Work preference must be FULL_TIME or PART_TIME',
  })
  workPreference?: 'FULL_TIME' | 'PART_TIME' | '';
}
