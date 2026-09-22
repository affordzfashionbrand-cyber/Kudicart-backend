import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('phone/send-otp')
  async sendOtp(@Body() body: { phoneNumber: string }) {
    return this.authService.sendOtp(body.phoneNumber);
  }

  @Post('phone/verify-otp')
  async verifyOtp(@Body() body: { phoneNumber: string; otp: string }) {
    return this.authService.verifyOtp(body.phoneNumber, body.otp);
  }
}
