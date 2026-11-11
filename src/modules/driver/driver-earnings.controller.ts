import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DriverEarningsService } from './driver-earnings.service';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/driver/earnings')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.DRIVER)
export class DriverEarningsController {
  constructor(private readonly earningsService: DriverEarningsService) {}

  @Get()
  async getEarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('weekIndex') weekIndex?: string,
  ) {
    const idx = weekIndex !== undefined ? parseInt(weekIndex, 10) : 0;
    return this.earningsService.getEarnings(user.driverId || user.id, isNaN(idx) ? 0 : idx);
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
