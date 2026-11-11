import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { UpdateAdminProfileDto } from '../dto/admin-actions.dto';
import { FirebaseAdminService } from '../../auth/firebase-admin.service';
import { Role } from '../../../common/enums/role.enum';
import { createJwtToken, verifyPassword } from '../../../common/utils/crypto.util';
import { isNonProductionEnvironment } from '../../../common/utils/phone.util';

interface StoredAdminCred {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  department?: string;
  passwordHash: string;
  twoFactorEnabled?: boolean;
  lastLogin?: string;
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async getAdminCredentialsList(): Promise<StoredAdminCred[]> {
    const setting = await this.prisma.workspaceSetting.findUnique({
      where: { key: 'adminCredentials' },
    });
    return Array.isArray(setting?.value) ? (setting!.value as unknown as StoredAdminCred[]) : [];
  }

  private async saveAdminCredentialsList(list: StoredAdminCred[]): Promise<void> {
    await this.prisma.workspaceSetting.upsert({
      where: { key: 'adminCredentials' },
      update: { value: list as any },
      create: { key: 'adminCredentials', value: list as any },
    });
  }

  async login(dto: AdminLoginDto, clientIp?: string, userAgent?: string) {
    if (!isNonProductionEnvironment() && process.env.ALLOW_DEV_ADMIN_PASSWORD !== 'true') {
      throw new ForbiddenException(
        'Direct admin password login is disabled in production. Use Firebase authentication.',
      );
    }
    this.ensureDbConnected();

    const emailNormalized = dto.email.trim().toLowerCase();
    const creds = await this.getAdminCredentialsList();
    const adminCred = creds.find((u) => u.email.toLowerCase() === emailNormalized);

    if (!adminCred) {
      throw new UnauthorizedException('Invalid administrative credentials');
    }

    if (adminCred.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'Administrative account is inactive. Contact Super Admin to reactivate.',
      );
    }

    const passwordValid = verifyPassword(dto.password, adminCred.passwordHash);
    if (!passwordValid) {
      await this.prisma.auditLog.create({
        data: {
          userId: adminCred.id,
          userEmail: emailNormalized,
          userRole: Role.ADMIN,
          action: 'ADMIN_LOGIN_FAILED',
          entityType: 'AdminAuth',
          entityId: adminCred.id,
          details: `Failed login attempt with invalid password for ${emailNormalized} (${userAgent || 'Affordz Admin Web'})`,
          ipAddress: clientIp || 'Unknown',
        },
      });
      throw new UnauthorizedException('Invalid administrative credentials');
    }

    let pgUser = await this.prisma.user.findUnique({ where: { email: emailNormalized } });
    if (!pgUser) {
      pgUser = await this.prisma.user.create({
        data: {
          id: `usr-admin-${randomUUID().slice(0, 8)}`,
          firebaseUid: `fb-admin-${adminCred.id.toLowerCase()}`,
          name: adminCred.name,
          email: emailNormalized,
          phone: null,
          role: Role.ADMIN,
          status: 'ACTIVE',
        },
      });
    } else if (pgUser.role !== Role.ADMIN || pgUser.status !== 'ACTIVE') {
      throw new ForbiddenException('Account does not have active administrative permissions');
    }

    adminCred.lastLogin = new Date().toISOString();
    await this.saveAdminCredentialsList(creds);

    await this.prisma.auditLog.create({
      data: {
        userId: pgUser.id,
        userEmail: pgUser.email,
        userRole: Role.ADMIN,
        action: 'ADMIN_LOGIN_SUCCESS',
        entityType: 'AdminAuth',
        entityId: pgUser.id,
        details: `Successful admin session initiated for ${pgUser.email} (Role: ${adminCred.role}, UA: ${userAgent || 'Affordz Admin Web'})`,
        ipAddress: clientIp || '127.0.0.1',
      },
    });

    const token = createJwtToken({
      sub: pgUser.id,
      adminId: adminCred.id,
      email: pgUser.email,
      name: pgUser.name,
      role: Role.ADMIN,
      adminRole: adminCred.role,
    });

    return {
      success: true,
      token,
      role: Role.ADMIN,
      user: {
        id: pgUser.id,
        adminId: adminCred.id,
        name: pgUser.name,
        email: pgUser.email,
        role: adminCred.role,
        department: adminCred.department || 'Operations',
        twoFactorEnabled: Boolean(adminCred.twoFactorEnabled),
        lastLogin: adminCred.lastLogin,
      },
    };
  }

  async loginFirebase(idToken: string, clientIp?: string, userAgent?: string) {
    if (!idToken) {
      throw new BadRequestException('Firebase ID token is required');
    }
    if (!this.firebaseAdmin) {
      throw new UnauthorizedException('Firebase authentication is not configured on this server');
    }
    this.ensureDbConnected();

    const decoded = await this.firebaseAdmin.verifyIdToken(idToken);
    if (!decoded || !decoded.uid) {
      throw new UnauthorizedException('Invalid Firebase ID token');
    }

    const emailNormalized = decoded.email ? decoded.email.trim().toLowerCase() : null;
    const creds = await this.getAdminCredentialsList();
    const adminCred = emailNormalized
      ? creds.find((u) => u.email.toLowerCase() === emailNormalized)
      : undefined;

    let pgUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { firebaseUid: decoded.uid },
          ...(emailNormalized ? [{ email: emailNormalized }] : []),
        ],
      },
    });

    if (!pgUser && !adminCred) {
      throw new ForbiddenException('No administrative access granted for this Firebase account');
    }

    if (pgUser && pgUser.role !== Role.ADMIN) {
      throw new ForbiddenException('No administrative access granted for this Firebase account');
    }

    if ((pgUser && pgUser.status !== 'ACTIVE') || (adminCred && adminCred.status !== 'ACTIVE')) {
      throw new ForbiddenException(
        'Administrative account is inactive. Contact Super Admin to reactivate.',
      );
    }

    if (!pgUser && adminCred && emailNormalized) {
      pgUser = await this.prisma.user.create({
        data: {
          id: `usr-admin-${randomUUID().slice(0, 8)}`,
          firebaseUid: decoded.uid,
          name: decoded.name || adminCred.name,
          email: emailNormalized,
          phone: null,
          role: Role.ADMIN,
          status: 'ACTIVE',
        },
      });
    } else if (pgUser && pgUser.firebaseUid.startsWith('fb-') && decoded.uid !== pgUser.firebaseUid) {
      const uidTaken = await this.prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
      if (!uidTaken) {
        pgUser = await this.prisma.user.update({
          where: { id: pgUser.id },
          data: { firebaseUid: decoded.uid },
        });
      }
    }

    if (adminCred) {
      adminCred.lastLogin = new Date().toISOString();
      await this.saveAdminCredentialsList(creds);
    }

    const adminRole = adminCred?.role || 'Super Admin';
    await this.prisma.auditLog.create({
      data: {
        userId: pgUser!.id,
        userEmail: pgUser!.email,
        userRole: Role.ADMIN,
        action: 'ADMIN_FIREBASE_LOGIN_SUCCESS',
        entityType: 'AdminAuth',
        entityId: pgUser!.id,
        details: `Successful Firebase Admin login for ${pgUser!.email} (Role: ${adminRole}, UA: ${userAgent || 'Affordz Admin Web (Firebase)'})`,
        ipAddress: clientIp || '127.0.0.1',
      },
    });

    const token = createJwtToken({
      sub: pgUser!.id,
      adminId: adminCred?.id || pgUser!.id,
      email: pgUser!.email,
      name: pgUser!.name,
      role: Role.ADMIN,
      adminRole,
    });

    return {
      success: true,
      token,
      role: Role.ADMIN,
      user: {
        id: pgUser!.id,
        adminId: adminCred?.id || pgUser!.id,
        name: pgUser!.name,
        email: pgUser!.email,
        role: adminRole,
        department: adminCred?.department || 'Operations',
        twoFactorEnabled: Boolean(adminCred?.twoFactorEnabled),
        lastLogin: adminCred?.lastLogin || new Date().toISOString(),
      },
    };
  }

  async getProfile(userId: string) {
    this.ensureDbConnected();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== Role.ADMIN) {
      throw new ForbiddenException('Administrative profile not found');
    }

    const creds = await this.getAdminCredentialsList();
    const cred = creds.find((u) => u.email.toLowerCase() === (user.email || '').toLowerCase());

    return {
      id: user.id,
      adminId: cred?.id || user.id,
      name: user.name,
      email: user.email,
      role: cred?.role || 'Super Admin',
      department: cred?.department || 'Operations',
      status: user.status,
      twoFactorEnabled: Boolean(cred?.twoFactorEnabled),
      lastLogin: cred?.lastLogin || user.updatedAt.toISOString(),
    };
  }

  async updateProfile(userId: string, dto: UpdateAdminProfileDto) {
    this.ensureDbConnected();
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing || existing.role !== Role.ADMIN) {
      throw new BadRequestException('Admin account not found');
    }

    const nextName = dto.displayName?.trim() || existing.name;
    const nextEmail = dto.email ? dto.email.trim().toLowerCase() : existing.email;

    const updated = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        name: nextName,
        email: nextEmail,
      },
    });

    const creds = await this.getAdminCredentialsList();
    const cred = creds.find(
      (u) =>
        u.email.toLowerCase() === (existing.email || '').toLowerCase() ||
        u.id === userId,
    );
    if (cred) {
      cred.name = nextName;
      if (nextEmail) cred.email = nextEmail;
      await this.saveAdminCredentialsList(creds);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: updated.id,
        userEmail: updated.email,
        userRole: Role.ADMIN,
        action: 'ADMIN_PROFILE_UPDATED',
        entityType: 'AdminAuth',
        entityId: updated.id,
        details: `Updated admin profile (${updated.name}, ${updated.email})`,
      },
    });

    return {
      success: true,
      user: {
        id: updated.id,
        adminId: cred?.id || updated.id,
        name: updated.name,
        email: updated.email,
        role: cred?.role || 'Super Admin',
      },
    };
  }

  async logout(userId: string) {
    this.ensureDbConnected();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          userEmail: user?.email || null,
          userRole: Role.ADMIN,
          action: 'ADMIN_LOGOUT',
          entityType: 'AdminAuth',
          entityId: userId,
          details: 'Admin explicitly signed out of session',
        },
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Signed out cleanly',
    };
  }
}
