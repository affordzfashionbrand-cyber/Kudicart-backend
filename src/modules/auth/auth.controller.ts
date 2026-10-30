import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';

@Controller('api/v1/auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('phone/send-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 5, duration: 60 }) // Max 5 SMS OTP requests per minute per client/phone
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phoneNumber);
  }

  @Post('phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ points: 10, duration: 60 }) // Max 10 verification attempts per minute against brute-forcing
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
}
