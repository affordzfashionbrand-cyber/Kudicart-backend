import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async sendOtp(phoneNumber: string) {
    if (!phoneNumber) {
      throw new BadRequestException('Phone number is required');
    }
    return {
      success: true,
      message: `OTP sent to ${phoneNumber}`,
      countdownSeconds: 24,
    };
  }

  async verifyOtp(phoneNumber: string, otp: string) {
    if (!otp || otp.length < 4) {
      throw new BadRequestException('Invalid OTP code');
    }
    const store = this.prisma.getStore();
    const user = store.users[0];
    return {
      success: true,
      token: `firebase-token-${Date.now()}`,
      user: {
        id: user.id,
        name: user.name,
        phone: phoneNumber || user.phone,
        email: user.email,
        avatar: user.avatar,
        address: store.addresses[0],
      },
    };
  }
}
