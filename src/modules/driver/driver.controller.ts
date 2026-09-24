import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriverService } from './driver.service';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/driver')
@UseGuards(FirebaseAuthGuard)
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

  @Get('orders')
  async getAssignedOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.driverService.getAssignedOrders(user.driverId || user.id, status);
  }

  @Get('orders/:id')
  async getOrderDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.driverService.getOrderDetails(user.driverId || user.id, id);
  }

  @Post('orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.driverService.acceptOrder(user.driverId || user.id, id);
  }

  @Post('orders/:id/pickup')
  @HttpCode(HttpStatus.OK)
  async pickupOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.driverService.pickupOrder(user.driverId || user.id, id);
  }

  @Post('orders/:id/out-for-delivery')
  @HttpCode(HttpStatus.OK)
  async outForDeliveryOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.driverService.outForDeliveryOrder(user.driverId || user.id, id);
  }

  @Post('orders/:id/deliver')
  @HttpCode(HttpStatus.OK)
  async deliverOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.driverService.deliverOrder(user.driverId || user.id, id);
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateLocationDto,
  ) {
    return this.driverService.updateLocation(user.driverId || user.id, body);
  }
}
