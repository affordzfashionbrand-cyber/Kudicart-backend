import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsBoolean,
  IsEmail,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @IsNotEmpty({ message: 'Category name is required' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Category code is required' })
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentCategory?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE' = 'ACTIVE';

  @IsOptional()
  @IsNumber()
  displayOrder?: number = 0;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentCategory?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsNumber()
  displayOrder?: number;
}

export class UpdateProductStatusDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'DRAFT', 'SUSPENDED', 'REVIEW'])
  listingStatus?: 'ACTIVE' | 'DRAFT' | 'SUSPENDED' | 'REVIEW';

  @IsOptional()
  @IsIn(['ACTIVE', 'DRAFT', 'SUSPENDED', 'REVIEW'])
  status?: 'ACTIVE' | 'DRAFT' | 'SUSPENDED' | 'REVIEW';
}

export class UpdateProductStockDto {
  @IsOptional()
  @IsNumber()
  stockQuantity?: number;

  @IsOptional()
  @IsNumber()
  stock?: number;

  @IsOptional()
  @IsIn(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'])
  stockStatus?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

  @IsOptional()
  @IsString()
  stockBadge?: string;
}

export class AdminAssignDriverDto {
  @IsNotEmpty({ message: 'Delivery Partner ID is required' })
  @IsString()
  driverId: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class AdminKycReviewDto {
  @IsNotEmpty({ message: 'KYC status is required' })
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class UpdateSettlementStatusDto {
  @IsNotEmpty({ message: 'Settlement status is required' })
  @IsIn(['CYCLE_ACCRUING', 'READY_FOR_TRANSFER', 'TRANSFERRED', 'HOLD'])
  status: 'CYCLE_ACCRUING' | 'READY_FOR_TRANSFER' | 'TRANSFERRED' | 'HOLD';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ModerateReviewDto {
  @IsNotEmpty({ message: 'Review moderation status is required' })
  @IsIn(['PUBLISHED', 'FLAGGED', 'REMOVED'])
  status: 'PUBLISHED' | 'FLAGGED' | 'REMOVED';

  @IsOptional()
  @IsString()
  flagReason?: string;
}

export class UpdateSupportTicketDto {
  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @IsString()
  resolutionRemarks?: string;

  @IsOptional()
  @IsString()
  resolutionNote?: string;
}

export class CreateAdminUserDto {
  @IsNotEmpty({ message: 'User name is required' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Valid email is required' })
  @IsEmail()
  email: string;

  @IsNotEmpty({ message: 'Role is required' })
  @IsString()
  role: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE' = 'ACTIVE';

  @IsOptional()
  @IsString()
  assignedTerminal?: string;
}

export class UpdateAdminUserRoleDto {
  @IsNotEmpty({ message: 'Role is required' })
  @IsString()
  role: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class UpdateRolePermissionsDto {
  @IsNotEmpty({ message: 'Role ID is required' })
  @IsString()
  roleId: string;

  @IsNotEmpty({ message: 'Permissions mapping is required' })
  permissions: Record<string, string[]>;
}

export class BroadcastNotificationDto {
  @IsNotEmpty({ message: 'Broadcast title is required' })
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  targetRole?: string = 'Central Admin';
}

export class WorkspacePreferencesDto {
  @IsOptional()
  @IsNumber()
  defaultPageSize?: number;

  @IsOptional()
  @IsString()
  currencyStandard?: string;

  @IsOptional()
  @IsIn(['IST', 'UTC'])
  timestampFormat?: 'IST' | 'UTC';

  @IsOptional()
  @IsBoolean()
  highDensityRows?: boolean;

  @IsOptional()
  @IsBoolean()
  audioAlertExceptions?: boolean;
}

export class CreateDarkStoreHubDto {
  @IsNotEmpty({ message: 'Hub name is required' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Locality is required' })
  @IsString()
  locality: string;

  @IsNotEmpty({ message: 'Address is required' })
  @IsString()
  address: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  deliveryMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDarkStoreHubDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  locality?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  deliveryMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCouponDto {
  @IsNotEmpty({ message: 'Coupon code is required' })
  @IsString()
  code: string;

  @IsOptional()
  @IsIn(['PERCENTAGE', 'FLAT'])
  discountType?: 'PERCENTAGE' | 'FLAT' = 'PERCENTAGE';

  @IsNumber()
  @Min(0)
  discountValue: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsNotEmpty({ message: 'End date is required' })
  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsIn(['PERCENTAGE', 'FLAT'])
  discountType?: 'PERCENTAGE' | 'FLAT';

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  usageLimit?: number | null;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}


