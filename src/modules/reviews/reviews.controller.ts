import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(FirebaseAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateReviewDto,
  ) {
    return this.reviewsService.createReview(user.id, body);
  }

  @Get('products/:productId')
  async getReviewsForProduct(@Param('productId') productId: string) {
    return this.reviewsService.getReviewsForProduct(productId);
  }
}
