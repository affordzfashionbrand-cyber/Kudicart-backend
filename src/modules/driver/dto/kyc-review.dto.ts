import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';

export class KycReviewDto {
  @IsNotEmpty({ message: 'Review status is required' })
  @IsString()
  @IsIn(['APPROVED', 'REJECTED'], {
    message: 'Status must be APPROVED or REJECTED',
  })
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
