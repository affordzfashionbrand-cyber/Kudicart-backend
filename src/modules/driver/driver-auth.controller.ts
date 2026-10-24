import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { DriverAuthService } from './driver-auth.service';
import { DriverSendOtpDto, DriverVerifyOtpDto } from './dto/driver-auth.dto';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/driver/auth')
@UseGuards(RateLimitGuard)
export class DriverAuthController {
  constructor(private readonly authService: DriverAuthService) {}

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async sendOtp(@Body() dto: DriverSendOtpDto) {
    const raw = dto.phoneNumber || dto.phone;
    if (!raw) {
      throw new BadRequestException('Enter a valid mobile number');
    }
    return this.authService.sendOtp(raw);
  }

  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async sendOtpAlias(@Body() dto: DriverSendOtpDto) {
    return this.sendOtp(dto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async verifyOtp(@Body() dto: DriverVerifyOtpDto) {
    const raw = dto.phoneNumber || dto.phone;
    if (!raw) {
      throw new BadRequestException('Enter a valid mobile number');
    }
    return this.authService.verifyOtp(raw, dto.otp);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async verifyOtpAlias(@Body() dto: DriverVerifyOtpDto) {
    return this.verifyOtp(dto);
  }

  @Get('status')
  @UseGuards(FirebaseAuthGuard)
  async getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getAccountStatus(user.driverId || user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  async logout() {
    return { success: true, message: 'Logged out successfully' };
  }
}
