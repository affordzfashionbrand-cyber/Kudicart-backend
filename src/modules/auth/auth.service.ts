import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import { FirebaseAdminService } from './firebase-admin.service';
import { createJwtToken } from '../../common/utils/crypto.util';
import {
  buildPhoneLookupCandidates,
  isNonProductionEnvironment,
  normalizeStoredPhone,
} from '../../common/utils/phone.util';
import { UpdateUserDto } from '../users/dto/update-user.dto';

interface StoredOtp {
  code: string;
  expiresAt: number;
  attempts: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private otpStore = new Map<string, StoredOtp>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private ensureDevOtpEnabled() {
    if (!isNonProductionEnvironment() || process.env.DISABLE_DEV_OTP === 'true') {
      throw new ForbiddenException(
        'Direct OTP authentication is disabled in production. Authenticate using Firebase Phone Auth ID token.',
      );
    }
  }

  private cleanPhone(phoneNumber: string): string {
    const trimmed = phoneNumber.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+${digits}`;
    }
    if (digits.length > 0) {
      return trimmed.startsWith('+') ? `+${digits}` : digits;
    }
    return trimmed;
  }

  getOtpForTesting(phoneNumber: string): string | undefined {
    if (process.env.NODE_ENV !== 'test') {
      throw new UnauthorizedException('Test OTP retrieval is disabled outside test environment');
    }
    const cleanPhone = this.cleanPhone(phoneNumber);
    return this.otpStore.get(cleanPhone)?.code;
  }

  async sendOtp(phoneNumber: string) {
    this.ensureDevOtpEnabled();

    const cleanPhone = this.cleanPhone(phoneNumber);
    const code = crypto.randomInt(100000, 999999).toString();

    this.otpStore.set(cleanPhone, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
    });

    const runtimeEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
    const exposeLocalDevOtp =
      isNonProductionEnvironment() &&
      runtimeEnv === 'development' &&
      process.env.NODE_ENV !== 'test' &&
      process.env.DISABLE_DEV_OTP !== 'true';

    if (exposeLocalDevOtp || process.env.NODE_ENV === 'development') {
      this.logger.log(`Dev customer OTP generated for ${cleanPhone}: ${code}`);
    }

    return {
      success: true,
      message: `OTP successfully sent via SMS to ${phoneNumber}`,
      expiresIn: 300,
      countdownSeconds: 30,
      ...(exposeLocalDevOtp ? { devOtp: code } : {}),
    };
  }

  async verifyOtp(phoneNumber: string, otp: string) {
    this.ensureDevOtpEnabled();
    this.ensureDbConnected();

    if (!otp || typeof otp !== 'string' || otp.trim().length < 4 || otp.trim().length > 6) {
      throw new BadRequestException('Invalid OTP code. Must be 4 to 6 digits.');
    }

    const cleanPhone = this.cleanPhone(phoneNumber);
    const trimmedOtp = otp.trim();
    const record = this.otpStore.get(cleanPhone);

    if (!record) {
      throw new UnauthorizedException(
        'No active OTP request found for this mobile number. Request a new OTP.',
      );
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

    if (record.code !== trimmedOtp) {
      throw new UnauthorizedException('Invalid OTP code. Please check the code and try again.');
    }

    this.otpStore.delete(cleanPhone);

    const phoneCandidates = buildPhoneLookupCandidates(cleanPhone);
    let user = await this.prisma.user.findFirst({
      where: {
        OR: phoneCandidates.map((p) => ({ phone: p })),
      },
      include: { driverProfile: true, vendor: true },
    });

    if (user && user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended. Access denied.');
    }

    if (user && user.role !== Role.CUSTOMER) {
      throw new ForbiddenException(
        `This mobile number is registered with role ${user.role}. Use the dedicated portal.`,
      );
    }

    if (!user) {
      const id = `usr-${crypto.randomUUID().slice(0, 8)}`;
      user = await this.prisma.user.create({
        data: {
          id,
          firebaseUid: `fb-${id}`,
          phone: cleanPhone,
          email: null,
          name: 'Affordz Customer',
          role: Role.CUSTOMER,
          status: 'ACTIVE',
        },
        include: { driverProfile: true, vendor: true },
      });
    }

    const payload = {
      sub: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: Role.CUSTOMER,
    };
    const token = createJwtToken(payload);

    return {
      success: true,
      token,
      role: Role.CUSTOMER,
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
      },
    };
  }

  async loginFirebase(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('Firebase ID token is required');
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
      include: { driverProfile: true, vendor: true },
    });

    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const newId = `usr-${crypto.randomUUID().slice(0, 8)}`;
      user = await this.prisma.user.create({
        data: {
          id: newId,
          firebaseUid: decoded.uid,
          phone: normalizedPhone,
          email: normalizedEmail,
          name: decoded.name?.trim() || 'Affordz Customer',
          avatar: decoded.picture || null,
          role: Role.CUSTOMER,
          status: 'ACTIVE',
        },
        include: { driverProfile: true, vendor: true },
      });
    } else {
      if (user.status !== 'ACTIVE') {
        throw new ForbiddenException('Account is inactive or suspended. Access denied.');
      }

      const updateFields: Record<string, any> = {};
      if (user.firebaseUid.startsWith('fb-') && decoded.uid && decoded.uid !== user.firebaseUid) {
        const uidTaken = await this.prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
        if (!uidTaken) {
          updateFields.firebaseUid = decoded.uid;
        }
      }
      if (!user.email && normalizedEmail) {
        const emailTaken = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!emailTaken) {
          updateFields.email = normalizedEmail;
        }
      }
      if (!user.phone && normalizedPhone) {
        const phoneTaken = await this.prisma.user.findUnique({ where: { phone: normalizedPhone } });
        if (!phoneTaken) {
          updateFields.phone = normalizedPhone;
        }
      }
      if (Object.keys(updateFields).length > 0) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: updateFields,
          include: { driverProfile: true, vendor: true },
        });
      }
    }

    const payload = {
      sub: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
      driverId: user.driverProfile?.id,
      vendorId: user.vendor?.id,
    };
    const token = createJwtToken(payload);

    return {
      success: true,
      token,
      role: user.role,
      isNewUser,
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        vendorId: user.vendor?.id,
        driverId: user.driverProfile?.id,
      },
    };
  }

  async getMe(userId: string) {
    this.ensureDbConnected();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendor: true, driverProfile: true },
    });
    if (!user) {
      throw new UnauthorizedException('User account not found');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended.');
    }

    return {
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
        vendorId: user.vendor?.id || null,
        vendor: user.vendor
          ? {
              id: user.vendor.id,
              storeName: user.vendor.storeName,
              status: user.vendor.status,
            }
          : null,
        driverId: user.driverProfile?.id || null,
      },
    };
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    this.ensureDbConnected();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User account not found');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended.');
    }

    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const trimmed = typeof dto.name === 'string' ? dto.name.trim() : '';
      if (!trimmed) {
        throw new BadRequestException('Name cannot be empty');
      }
      data.name = trimmed;
    }
    if (dto.email !== undefined) {
      const trimmed = typeof dto.email === 'string' ? dto.email.trim() : '';
      data.email = trimmed ? trimmed.toLowerCase() : null;
    }
    if (dto.phone !== undefined) {
      const trimmed = typeof dto.phone === 'string' ? dto.phone.trim() : '';
      data.phone = trimmed ? trimmed : null;
    }
    if (dto.avatar !== undefined) {
      data.avatar = dto.avatar && typeof dto.avatar === 'string' && dto.avatar.trim() ? dto.avatar.trim() : null;
    }

    try {
      const updated =
        Object.keys(data).length > 0
          ? await this.prisma.user.update({ where: { id: user.id }, data })
          : user;
      return {
        success: true,
        user: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          avatar: updated.avatar,
          role: updated.role,
          status: updated.status,
        },
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Email or phone is already linked to another account.');
      }
      throw new BadRequestException(`Failed to update profile: ${err?.message || 'Unknown error'}`);
    }
  }

  async logout(userId: string, fcmToken?: string) {
    this.ensureDbConnected();
    if (fcmToken?.trim()) {
      await this.prisma.deviceToken.updateMany({
        where: { userId, token: fcmToken.trim() },
        data: { isActive: false },
      });
    }
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          userRole: Role.CUSTOMER,
          action: 'USER_LOGOUT',
          entityType: 'User',
          entityId: userId,
          details: 'Authenticated user signed out cleanly',
        },
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Signed out cleanly',
    };
  }
}
