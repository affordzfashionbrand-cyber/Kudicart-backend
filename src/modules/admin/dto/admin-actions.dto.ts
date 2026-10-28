import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateCustomerStatusDto {
  @IsString()
  status: 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class VendorReviewActionDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  reviewer?: string;
}

