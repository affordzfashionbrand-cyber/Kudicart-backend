import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
  Optional,
  Logger,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import { createJwtToken } from '../../common/utils/crypto.util';
import {
  buildPhoneLookupCandidates,
  isNonProductionEnvironment,
  normalizeStoredPhone,
} from '../../common/utils/phone.util';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

interface OtpEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
}

@Injectable()
export class DriverAuthService {
  private readonly logger = new Logger(DriverAuthService.name);
  private otpStore = new Map<string, OtpEntry>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private ensureDevOtpEnabled() {
    if (!isNonProductionEnvironment() || process.env.DISABLE_DEV_OTP === 'true') {
      throw new ForbiddenException(
        'Direct driver OTP endpoints are disabled in production. Use Firebase Phone Auth ID token.',
      );
    }
  }

  private normalizeDigits(phone: string): string {
    return phone.replace(/[^0-9]/g, '').slice(-10);
  }

  getOtpForTesting(phoneNumber: string): string | undefined {
    if (process.env.NODE_ENV !== 'test') {
      throw new UnauthorizedException('Test OTP retrieval is disabled outside test environment');
    }
    const cleanPhone = this.normalizeDigits(phoneNumber);
    return this.otpStore.get(cleanPhone)?.otp;
  }

  async sendOtp(phoneNumber: string) {
    this.ensureDevOtpEnabled();

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new BadRequestException('Valid mobile number is required');
    }

    const cleanPhone = this.normalizeDigits(phoneNumber);
    if (
      cleanPhone.length < 10 ||
      !/^[6-9]\d{9}$/.test(cleanPhone) ||
      /^(\d)\1{9}$/.test(cleanPhone)
    ) {
      throw new BadRequestException(
        'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
      );
    }

    const otp = randomInt(100000, 999999).toString();
    this.otpStore.set(cleanPhone, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
    });

    if (process.env.NODE_ENV === 'development') {
      this.logger.log(`Dev driver OTP generated for ${cleanPhone}: ${otp}`);
    }

    return {
      success: true,
      message: 'Verification OTP dispatched',
      expiresInSeconds: 300,
    };
  }

  async verifyOtp(phoneNumber: string, otp: string) {
    this.ensureDevOtpEnabled();
    this.ensureDbConnected();

    if (!phoneNumber || !otp) {
      throw new BadRequestException('Phone number and OTP are required');
    }

    const cleanPhone = this.normalizeDigits(phoneNumber);
    const trimmedOtp = otp.trim();
    const record = this.otpStore.get(cleanPhone);

    if (!record) {
      throw new UnauthorizedException('No active OTP request found. Please request a new OTP.');
    }
    if (Date.now() > record.expiresAt) {
      this.otpStore.delete(cleanPhone);
      throw new UnauthorizedException('OTP has expired. Please request a new OTP.');
    }

    record.attempts += 1;
    if (record.attempts > 5) {
      this.otpStore.delete(cleanPhone);
      throw new BadRequestException('Too many failed verification attempts. Please request a new OTP.');
    }

    if (record.otp !== trimmedOtp) {
      throw new UnauthorizedException('Invalid OTP code entered.');
    }

    this.otpStore.delete(cleanPhone);

    const formattedPhone = `+91 ${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}`;
    const candidates = buildPhoneLookupCandidates(formattedPhone);

    let user = await this.prisma.user.findFirst({
      where: {
        OR: candidates.map((phone) => ({ phone })),
      },
      include: { driverProfile: true },
    });

    if (user && user.status !== 'ACTIVE') {
      throw new ForbiddenException('Driver account is inactive or suspended');
    }

    if (user && user.role !== Role.DRIVER) {
      throw new ForbiddenException(
        `This phone is registered with role ${user.role}, not DRIVER.`,
      );
    }

    if (!user) {
      const userId = `usr-drv-${randomUUID().slice(0, 8)}`;
      const driverId = `drv-${randomUUID().slice(0, 8)}`;
      user = await this.prisma.user.create({
        data: {
          id: userId,
          firebaseUid: `fb-${userId}`,
          name: `Rider ${cleanPhone.slice(-4)}`,
          phone: formattedPhone,
          email: null,
          role: Role.DRIVER,
          status: 'ACTIVE',
          driverProfile: {
            create: {
              id: driverId,
              fullName: `Rider ${cleanPhone.slice(-4)}`,
              phone: formattedPhone,
              workPreference: 'FULL_TIME',
              tier: 'Starter',
              rating: 5.0,
              completedDeliveries: 0,
              isOnline: false,
              kycStatus: 'PENDING',
            },
          },
        },
        include: { driverProfile: true },
      });
    } else if (!user.driverProfile) {
      const driverProfile = await this.prisma.driverProfile.create({
        data: {
          id: `drv-${randomUUID().slice(0, 8)}`,
          userId: user.id,
          fullName: user.name,
          phone: user.phone || formattedPhone,
          workPreference: 'FULL_TIME',
          tier: 'Starter',
          rating: 5.0,
          completedDeliveries: 0,
          isOnline: false,
          kycStatus: 'PENDING',
        },
      });
      user = { ...user, driverProfile };
    }

    const driver = user.driverProfile!;
    const token = createJwtToken({
      sub: user.id,
      driverId: driver.id,
      phone: user.phone,
      email: user.email,
      name: driver.fullName || user.name,
      role: Role.DRIVER,
    });

    return {
      success: true,
      token,
      role: Role.DRIVER,
      driverId: driver.id,
      user: {
        id: user.id,
        driverId: driver.id,
        name: driver.fullName,
        phone: driver.phone,
        email: user.email,
        kycStatus: driver.kycStatus,
        tier: driver.tier,
        role: Role.DRIVER,
      },
    };
  }

  async loginFirebase(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('Firebase ID token is required');
    }
    if (!this.firebaseAdmin) {
      throw new UnauthorizedException('Firebase authentication service is not configured');
    }
    this.ensureDbConnected();

    const decoded = await this.firebaseAdmin.verifyIdToken(idToken);
    if (!decoded || !decoded.uid) {
      throw new UnauthorizedException('Invalid Firebase ID token');
    }

    const normalizedEmail = decoded.email ? decoded.email.trim().toLowerCase() : null;
    const normalizedPhone = normalizeStoredPhone(decoded.phoneNumber);
    const phoneCandidates = buildPhoneLookupCandidates(normalizedPhone);

    const orClauses: any[] = [{ firebaseUid: decoded.uid }];
    if (normalizedEmail) {
      orClauses.push({ email: normalizedEmail });
    }
    if (phoneCandidates.length > 0) {
      orClauses.push(...phoneCandidates.map((p) => ({ phone: p })));
    }

    let user = await this.prisma.user.findFirst({
      where: { OR: orClauses },
      include: { driverProfile: true },
    });

    if (user && user.status !== 'ACTIVE') {
      throw new ForbiddenException('Driver account is inactive or suspended');
    }
    if (user && user.role !== Role.DRIVER) {
      throw new ForbiddenException(
        `Account is registered as ${user.role} and cannot sign in to the Driver portal`,
      );
    }

    let isNewDriver = false;
    if (!user) {
      isNewDriver = true;
      const userId = `usr-drv-${randomUUID().slice(0, 8)}`;
      const driverId = `drv-${randomUUID().slice(0, 8)}`;
      const displayName = decoded.name?.trim() || 'Affordz Rider';
      user = await this.prisma.user.create({
        data: {
          id: userId,
          firebaseUid: decoded.uid,
          name: displayName,
          phone: normalizedPhone,
          email: normalizedEmail,
          avatar: decoded.picture || null,
          role: Role.DRIVER,
          status: 'ACTIVE',
          driverProfile: {
            create: {
              id: driverId,
              fullName: displayName,
              phone: normalizedPhone || '',
              workPreference: 'FULL_TIME',
              tier: 'Starter',
              rating: 5.0,
              completedDeliveries: 0,
              isOnline: false,
              kycStatus: 'PENDING',
            },
          },
        },
        include: { driverProfile: true },
      });
    } else {
      if (user.firebaseUid.startsWith('fb-') && decoded.uid !== user.firebaseUid) {
        const uidTaken = await this.prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
        if (!uidTaken) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { firebaseUid: decoded.uid },
            include: { driverProfile: true },
          });
        }
      }
      if (!user.driverProfile) {
        isNewDriver = true;
        const driverProfile = await this.prisma.driverProfile.create({
          data: {
            id: `drv-${randomUUID().slice(0, 8)}`,
            userId: user.id,
            fullName: user.name,
            phone: user.phone || normalizedPhone || '',
            workPreference: 'FULL_TIME',
            tier: 'Starter',
            rating: 5.0,
            completedDeliveries: 0,
            isOnline: false,
            kycStatus: 'PENDING',
          },
        });
        user = { ...user, driverProfile };
      }
    }

    const driver = user.driverProfile!;
    const token = createJwtToken({
      sub: user.id,
      driverId: driver.id,
      phone: user.phone,
      email: user.email,
      name: driver.fullName || user.name,
      role: Role.DRIVER,
    });

    return {
      success: true,
      token,
      role: Role.DRIVER,
      driverId: driver.id,
      isNewDriver,
      user: {
        id: user.id,
        driverId: driver.id,
        firebaseUid: user.firebaseUid,
        name: driver.fullName,
        phone: driver.phone || user.phone,
        email: user.email,
        kycStatus: driver.kycStatus,
        tier: driver.tier,
        role: Role.DRIVER,
      },
    };
  }

  async getAccountStatus(driverOrUserId: string) {
    this.ensureDbConnected();
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverOrUserId }, { userId: driverOrUserId }] },
      include: { user: true },
    });

    if (!driver) {
      throw new UnauthorizedException('Driver account not found');
    }

    return {
      driverId: driver.id,
      userId: driver.userId,
      fullName: driver.fullName,
      kycStatus: driver.kycStatus,
      isApproved: driver.kycStatus === 'APPROVED',
      isOnline: driver.isOnline,
      rating: driver.rating,
      tier: driver.tier,
      status: driver.user?.status || 'ACTIVE',
    };
  }
}
