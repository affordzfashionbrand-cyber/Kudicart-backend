import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async sendOtp(phoneNumber: string) {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new BadRequestException('Valid phone number is required');
    }

    return {
      success: true,
      message: `OTP successfully sent via SMS to ${phoneNumber}`,
      countdownSeconds: 30,
      mockOtpForTesting: '742900',
    };
  }

  async verifyOtp(phoneNumber: string, otp: string) {
    if (!otp || otp.length < 4) {
      throw new BadRequestException('Invalid OTP code. Must be 4 to 6 digits.');
    }

    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const store = this.prisma.getStore();

    // Check if phone matches our driver
    const isDriver = cleanPhone.includes('9876543210') || cleanPhone.includes('98765');
    if (isDriver) {
      const driverUser = store.users.find((u) => u.role === 'DRIVER') || store.users[1];
      const driverInfo = store.drivers[0];
      return {
        success: true,
        token: `mock-driver-token-${Date.now()}`,
        role: Role.DRIVER,
        user: {
          id: driverUser.id,
          name: driverUser.name,
          phone: phoneNumber,
          email: driverUser.email,
          avatar: driverUser.avatar,
          driverId: driverInfo.id,
          vehicle: driverInfo.vehicle,
          kycStatus: driverInfo.kycStatus,
          isOnline: driverInfo.isOnline,
        },
      };
    }

    // Customer
    const customerUser = store.users.find((u) => u.role === 'CUSTOMER') || store.users[0];
    const defaultAddress = store.addresses.find((a) => a.userId === customerUser.id && a.isDefault) || store.addresses[0];

    return {
      success: true,
      token: `mock-customer-token-${Date.now()}`,
      role: Role.CUSTOMER,
      user: {
        id: customerUser.id,
        name: customerUser.name,
        phone: phoneNumber,
        email: customerUser.email,
        avatar: customerUser.avatar,
        defaultAddress,
      },
    };
  }
}
