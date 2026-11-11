import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { FirebaseAuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserDto } from '../users/dto/update-user.dto';

@Controller('api/v1/auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('phone/send-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 5, duration: 60 })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phoneNumber);
  }

  @Post('phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phoneNumber, dto.otp);
  }

  @Post('login-firebase')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async loginFirebase(@Body() dto: FirebaseLoginDto) {
    return this.authService.loginFirebase(dto.idToken);
  }

  @Post('firebase/login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 15, duration: 60 })
  async firebaseLogin(@Body() dto: FirebaseLoginDto) {
    return this.authService.loginFirebase(dto.idToken);
  }

  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }

  @Patch('me')
  @UseGuards(FirebaseAuthGuard)
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ) {
    return this.authService.updateMe(user.id, dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body?: { fcmToken?: string },
  ) {
    return this.authService.logout(user.id, body?.fcmToken);
  }
}
