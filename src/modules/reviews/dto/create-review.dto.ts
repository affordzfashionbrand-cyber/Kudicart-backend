import { IsNotEmpty, IsString, IsInt, Min, Max, Length } from 'class-validator';

export class CreateReviewDto {
  @IsNotEmpty({ message: 'orderId is required' })
  @IsString()
  orderId: string;

  @IsNotEmpty({ message: 'productId is required' })
  @IsString()
  productId: string;

  @IsNotEmpty({ message: 'rating is required' })
  @IsInt()
  @Min(1, { message: 'Rating must be at least 1 star' })
  @Max(5, { message: 'Rating cannot exceed 5 stars' })
  rating: number;

  @IsNotEmpty({ message: 'Review comment is required' })
  @IsString()
  @Length(5, 500, { message: 'Review comment must be between 5 and 500 characters' })
  comment: string;
}
