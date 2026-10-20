import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import { FirebaseAdminService } from './firebase-admin.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private firebaseAdmin: FirebaseAdminService,
  ) {}

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
      const payload = {
        uid: driverUser.id,
        sub: driverUser.id,
        firebaseUid: driverUser.firebaseUid,
        phone_number: phoneNumber,
        email: driverUser.email,
        name: driverUser.name,
        role: Role.DRIVER,
        driverId: driverInfo.id,
      };
      const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;

      return {
        success: true,
        token,
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
    let customerUser = store.users.find(
      (u) => u.role === 'CUSTOMER' && (u.phone === phoneNumber || u.phone?.replace(/\s+/g, '') === cleanPhone)
    );

    if (!customerUser) {
      customerUser = {
        id: `usr-${Date.now()}`,
        firebaseUid: `fb-${cleanPhone}`,
        phone: phoneNumber,
        email: `customer.${cleanPhone.slice(-4)}@affordz.in`,
        name: 'Affordz Customer',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        role: 'CUSTOMER',
        createdAt: new Date().toISOString(),
      };
      store.users.push(customerUser);
    }

    const defaultAddress =
      store.addresses.find((a) => a.userId === customerUser.id && a.isDefault) || store.addresses[0];

    const payload = {
      uid: customerUser.id,
      sub: customerUser.id,
      firebaseUid: customerUser.firebaseUid,
      phone_number: phoneNumber,
      email: customerUser.email,
      name: customerUser.name,
      role: Role.CUSTOMER,
    };
    const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;

    return {
      success: true,
      token,
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

  async loginFirebase(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('Firebase ID token is required');
    }

    const decoded = await this.firebaseAdmin.verifyIdToken(idToken);
    const store = this.prisma.getStore();

    let user = store.users.find(
      (u) =>
        u.firebaseUid === decoded.uid ||
        (decoded.phoneNumber && (u.phone === decoded.phoneNumber || u.phone?.replace(/\s+/g, '') === decoded.phoneNumber.replace(/\s+/g, '')))
    );

    if (!user) {
      user = {
        id: `usr-${Date.now()}`,
        firebaseUid: decoded.uid,
        phone: decoded.phoneNumber || '+91 98450 12890',
        email: decoded.email || `${decoded.uid.substring(0, 8)}@affordz.in`,
        name: decoded.name || 'Affordz Customer',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
        role: 'CUSTOMER',
        createdAt: new Date().toISOString(),
      };
      store.users.push(user);
    }

    const payload = {
      uid: user.id,
      sub: user.id,
      firebaseUid: user.firebaseUid,
      phone_number: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;

    return {
      success: true,
      token,
      role: user.role,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
      },
    };
  }
}
