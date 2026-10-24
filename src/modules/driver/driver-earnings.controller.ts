import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DriverEarningsService } from './driver-earnings.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/driver/earnings')
@UseGuards(FirebaseAuthGuard)
export class DriverEarningsController {
  constructor(private readonly earningsService: DriverEarningsService) {}

  @Get()
  async getEarnings(@Query('weekIndex') weekIndex?: string) {
    const idx = weekIndex !== undefined ? parseInt(weekIndex, 10) : 0;
    return this.earningsService.getEarnings(isNaN(idx) ? 0 : idx);
  }

  @Get('bonus')
  async getBonusProgress(@CurrentUser() user: AuthenticatedUser) {
    return this.earningsService.getBonusProgress(user.driverId || user.id);
  }

  @Get('opportunities')
  async getOpportunities() {
    return this.earningsService.getOpportunities();
  }

  @Get('surges')
  async getSurges() {
    return this.earningsService.getSurges();
  }
}
