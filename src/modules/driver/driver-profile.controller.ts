import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriverProfileService } from './driver-profile.service';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { DocumentUploadDto } from './dto/document-upload.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@Controller('api/v1/driver/profile')
@UseGuards(FirebaseAuthGuard, RateLimitGuard)
export class DriverProfileController {
  constructor(private readonly profileService: DriverProfileService) {}

  @Get()
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getProfile(user.driverId || user.id);
  }

  @Put('details')
  @RateLimit({ points: 10, duration: 60 })
  async updateDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateDriverProfileDto,
  ) {
    return this.profileService.updateDetails(user.driverId || user.id, body);
  }

  @Put('vehicle')
  @RateLimit({ points: 10, duration: 60 })
  async updateVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateVehicleDto,
  ) {
    return this.profileService.updateVehicle(user.driverId || user.id, body);
  }

  @Post('documents')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 20, duration: 60 })
  async uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DocumentUploadDto,
  ) {
    return this.profileService.uploadDocument(user.driverId || user.id, body);
  }

  @Post('documents/upload')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 20, duration: 60 })
  async uploadDocumentAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DocumentUploadDto,
  ) {
    return this.profileService.uploadDocument(user.driverId || user.id, body);
  }

  @Get('kyc')
  async getKycStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getKycStatus(user.driverId || user.id);
  }

  @Get('kyc/status')
  async getKycStatusAlias(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getKycStatus(user.driverId || user.id);
  }

  @Post('kyc/submit')
  @HttpCode(HttpStatus.OK)
  async submitKyc(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.submitKyc(user.driverId || user.id);
  }

  @Patch('availability')
  @RateLimit({ points: 10, duration: 60 })
  async updateAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateDriverStatusDto,
  ) {
    return this.profileService.updateAvailability(user.driverId || user.id, body.isOnline);
  }

  @Put('availability')
  @RateLimit({ points: 10, duration: 60 })
  async updateAvailabilityPut(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateDriverStatusDto,
  ) {
    return this.profileService.updateAvailability(user.driverId || user.id, body.isOnline);
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateLocationDto,
  ) {
    return this.profileService.updateLocation(user.driverId || user.id, body);
  }
}
