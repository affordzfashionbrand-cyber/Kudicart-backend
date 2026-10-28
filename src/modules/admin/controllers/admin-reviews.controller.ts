import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminReviewsService } from '../services/admin-reviews.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { ModerateReviewDto } from '../dto/admin-domain.dto';
import { FirebaseAuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Controller('api/v1/admin/reviews')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminReviewsController {
  constructor(private readonly reviewsService: AdminReviewsService) {}

  @Get()
  async listReviews(@Query() query: AdminQueryDto) {
    return this.reviewsService.listReviews(query);
  }

  @Get('metrics')
  async getReviewMetrics() {
    return this.reviewsService.getReviewMetrics();
  }

  @Patch(':id/moderate')
  async moderateReview(
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.reviewsService.moderateReview(
      id,
      dto,
      actor?.id,
      actor?.name,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteReview(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.reviewsService.deleteReview(id, actor?.id, actor?.name);
  }
}

