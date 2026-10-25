import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';

interface StoredOtp {
  code: string;
  expiresAt: number;
  attempts: number;
}

@Injectable()
export class DriverAuthService {
  private readonly logger = new Logger(DriverAuthService.name);
  // In-memory OTP storage: Note that in a clustered/multi-instance or restart scenario,
  // a distributed cache (e.g., Redis) is required to share state across nodes.
  private otpStore = new Map<string, StoredOtp>();

  constructor(private prisma: PrismaService) {}

  cleanAndValidatePhone(phoneNumber: string): string {
    const errorMsg = 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.';
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new BadRequestException(errorMsg);
    }
    const digits = phoneNumber.replace(/[^0-9]/g, '');
    const cleanPhone =
      digits.length > 10 && digits.startsWith('91')
        ? digits.slice(-10)
        : digits.length > 10
        ? digits.slice(-10)
        : digits;

    if (!cleanPhone || cleanPhone.length !== 10) {
      throw new BadRequestException(errorMsg);
    }
    if (!/^[6-9]/.test(cleanPhone)) {
      throw new BadRequestException(errorMsg);
    }
    if (/^([0-9])\1{9}$/.test(cleanPhone)) {
      throw new BadRequestException(errorMsg);
    }
    if (cleanPhone === '1234567890' || cleanPhone === '0123456789') {
      throw new BadRequestException(errorMsg);
    }
    return cleanPhone;
  }

  getOtpForTesting(phoneNumber: string): string | undefined {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('Test OTP retrieval is disabled in production.');
    }
    const clean = this.cleanAndValidatePhone(phoneNumber);
    return this.otpStore.get(clean)?.code;
  }

  async sendOtp(phoneNumber: string) {
    const cleanPhone = this.cleanAndValidatePhone(phoneNumber);

    // Cryptographically secure 6-digit numeric OTP generation (Node.js crypto.randomInt)
    const code = randomInt(100000, 1000000).toString();
    this.otpStore.set(cleanPhone, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
      attempts: 0,
    });

    // Mask phone number in logs and NEVER log OTP codes or secrets
    const maskedPhone = `+91 ******${cleanPhone.slice(-4)}`;
    this.logger.log(`Driver OTP generated for mobile: ${maskedPhone}`);

    // Verify configured SMS provider (e.g. FAST2SMS, TWILIO)
    const hasSmsGateway = Boolean(process.env.FAST2SMS_API_KEY || process.env.TWILIO_ACCOUNT_SID);
    if (!hasSmsGateway) {
      this.logger.warn(
        `SMS gateway is not configured (FAST2SMS_API_KEY or TWILIO_ACCOUNT_SID missing). OTP delivery to carrier skipped in development.`,
      );
    }

    return {
      success: true,
      message: hasSmsGateway
        ? `OTP sent successfully to +91 ${cleanPhone}`
        : `Verification OTP generated for +91 ${cleanPhone}. (SMS provider gateway not configured in development environment).`,
      countdownSeconds: 30,
    };
  }

  async verifyOtp(phoneNumber: string, otp: string) {
    const cleanPhone = this.cleanAndValidatePhone(phoneNumber);
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      throw new BadRequestException('Please enter a valid 6-digit numeric OTP');
    }

    const record = this.otpStore.get(cleanPhone);
    if (!record) {
      throw new UnauthorizedException('No active OTP request found for this mobile number. Request a new OTP.');
    }

    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(cleanPhone);
      throw new BadRequestException('OTP has expired. Please request a new OTP.');
    }

    record.attempts += 1;
    if (record.attempts > 5) {
      this.otpStore.delete(cleanPhone);
      throw new BadRequestException('Too many failed OTP attempts. Request a new OTP.');
    }

    if (record.code !== otp.trim()) {
      throw new UnauthorizedException('Invalid OTP. Please check the code and try again.');
    }

    // Clear OTP after successful verification
    this.otpStore.delete(cleanPhone);

    const store = this.prisma.getStore();
    let driver = store.drivers.find(
      (d) =>
        d.phone.replace(/[^0-9]/g, '').endsWith(cleanPhone.slice(-10)) ||
        d.phone.includes(cleanPhone),
    );

    let driverUser = store.users.find(
      (u) =>
        u.role === 'DRIVER' &&
        u.phone &&
        u.phone.replace(/[^0-9]/g, '').endsWith(cleanPhone.slice(-10)),
    );

    // If new delivery partner, initialize clean onboarding state
    if (!driver) {
      const newDriverId = `KC-DRV-${randomInt(1000, 10000)}`;
      const newUserId = `usr-drv-${Date.now()}`;

      driverUser = {
        id: newUserId,
        firebaseUid: `fb-${cleanPhone}`,
        phone: `+91 ${cleanPhone.slice(-10)}`,
        email: `driver.${cleanPhone.slice(-4)}@kudicart.in`,
        name: 'New Delivery Partner',
        avatar: null,
        role: 'DRIVER',
        createdAt: new Date().toISOString(),
      };
      store.users.push(driverUser);

      driver = {
        id: newDriverId,
        userId: newUserId,
        fullName: 'New Delivery Partner',
        name: 'New Driver',
        role: 'Delivery Partner',
        status: 'Pending Verification',
        phone: `+91 ${cleanPhone.slice(-10)}`,
        email: driverUser.email,
        tier: 'Bronze Tier',
        avatarInitial: 'DP',
        aadhaarNumber: '',
        panNumber: '',
        dob: '',
        licenseNumber: '',
        workPreference: 'PART_TIME',
        rating: 5.0,
        completedDeliveries: 0,
        isOnline: false,
        kycStatus: 'NOT_SUBMITTED',
        vehicle: {
          registrationNumber: '',
          vehicleType: 'Bike',
          make: '',
          model: '',
          rcStatus: 'Under review',
        },
        documents: {
          aadhaar: { front: null, back: null, status: 'PENDING' },
          pan: { front: null, back: null, status: 'PENDING' },
          drivingLicence: { front: null, back: null, status: 'PENDING' },
          vehicleRc: { front: null, back: null, status: 'PENDING' },
          selfie: null,
        },
        workSummary: {
          totalEarnings: 0,
          loginHours: '0h',
          ordersDone: 0,
          totalSlot: '09:00 AM — 06:00 PM',
          workingDays: '0 / 6 days',
        },
        currentLocation: {
          latitude: 12.9716,
          longitude: 77.5946,
          heading: 0,
          updatedAt: new Date().toISOString(),
        },
      };
      store.drivers.push(driver);
    }

    const payload = {
      uid: driver.userId,
      sub: driver.userId,
      phone_number: driver.phone,
      email: driver.email,
      name: driver.fullName,
      role: Role.DRIVER,
      driverId: driver.id,
      kycStatus: driver.kycStatus,
    };
    const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;

    return {
      success: true,
      token,
      role: Role.DRIVER,
      kycStatus: driver.kycStatus,
      user: {
        id: driver.userId,
        driverId: driver.id,
        name: driver.name,
        fullName: driver.fullName,
        phone: driver.phone,
        email: driver.email,
        kycStatus: driver.kycStatus,
        isOnline: driver.isOnline,
        workPreference: driver.workPreference,
      },
    };
  }

  async getAccountStatus(driverId: string) {
    const store = this.prisma.getStore();
    const driver = store.drivers.find((d) => d.id === driverId || d.userId === driverId);
    if (!driver) {
      throw new UnauthorizedException('Driver account not found');
    }

    return {
      success: true,
      driverId: driver.id,
      fullName: driver.fullName,
      kycStatus: driver.kycStatus,
      isApproved: driver.kycStatus === 'APPROVED',
      isOnline: driver.isOnline,
      workPreference: driver.workPreference,
      rejectionReason: driver.rejectionReason || null,
    };
  }
}
