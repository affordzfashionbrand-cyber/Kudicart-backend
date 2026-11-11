import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { DriverService } from './driver.service';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Legacy Driver profile/location controller.
 * All `api/v1/driver/orders/*` routes are exclusively owned by DriverOrdersController.
 */
@Controller('api/v1/driver')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.DRIVER)
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.driverService.getProfile(user.driverId || user.id);
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateDriverProfileDto,
  ) {
    return this.driverService.updateProfile(user.driverId || user.id, body);
  }

  @Get('kyc')
  async getKycStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.driverService.getKycStatus(user.driverId || user.id);
  }

  @Patch('availability')
  async updateAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateDriverStatusDto,
  ) {
    return this.driverService.updateAvailability(user.driverId || user.id, body.isOnline);
  }

  @Post('location')
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateLocationDto,
  ) {
    return this.driverService.updateLocation(user.driverId || user.id, body);
  }
}
