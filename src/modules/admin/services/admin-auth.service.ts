import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Role } from '../../../common/enums/role.enum';
import {
  verifyPassword,
  createJwtToken,
} from '../../../common/utils/crypto.util';
import { FirebaseAdminService } from '../../auth/firebase-admin.service';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { UpdateAdminProfileDto } from '../dto/admin-actions.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private prisma: PrismaService,
    @Optional() private firebaseAdmin?: FirebaseAdminService,
  ) {}

  async login(dto: AdminLoginDto, clientIp?: string, userAgent?: string) {
    const cleanEmail = dto.email.trim().toLowerCase();
    const store = this.prisma.getStore();

    // Find admin user in store
    const adminUser = store.adminUsers.find(
      (u: any) => u.email.toLowerCase() === cleanEmail,
    );

    if (!adminUser) {
      throw new UnauthorizedException('Invalid administrative credentials');
    }

    if (adminUser.status === 'INACTIVE') {
      throw new ForbiddenException(
        'This administrative account has been deactivated. Contact Super Admin.',
      );
    }

    // Verify password against stored PBKDF2 hash
    const isPasswordValid = verifyPassword(dto.password, adminUser.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid administrative credentials');
    }

    // Update last active
    adminUser.lastActive = 'Just now';

    // Generate JWT token
    const token = createJwtToken({
      uid: adminUser.userId || adminUser.id,
      sub: adminUser.userId || adminUser.id,
      adminId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: Role.ADMIN,
      adminRole: adminUser.role,
      department: adminUser.department,
    });

    // Record audit event
    this.prisma.recordAuditEvent({
      actorId: adminUser.id,
      actorName: adminUser.name,
      actorRole: adminUser.role,
      actionType: 'ADMIN_SIGN_IN' as any,
      entityId: adminUser.id,
      entityName: adminUser.name,
      entityType: 'User' as any,
      ipAddress: clientIp || '127.0.0.1',
      userAgent: userAgent || 'KudiCart Admin Web',
      summary: `Admin sign-in successful for ${adminUser.name} (${adminUser.email})`,
      targetDescription: `Administrative Session Created (${adminUser.role})`,
      changePayload: {
        adminId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      },
    });

    return {
      success: true,
      message: 'Administrative authentication successful',
      token,
      role: Role.ADMIN,
      adminRole: adminUser.role,
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: Role.ADMIN,
        adminRole: adminUser.role,
        department: adminUser.department,
        avatarInitials: adminUser.avatarInitials,
        assignedTerminal: adminUser.assignedTerminal,
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

    const decoded = await this.firebaseAdmin.verifyIdToken(idToken);
    const store = this.prisma.getStore();

    const cleanEmail = decoded.email?.trim().toLowerCase();
    const adminUser = store.adminUsers.find(
      (u: any) =>
        (cleanEmail && u.email.toLowerCase() === cleanEmail) ||
        u.userId === decoded.uid ||
        u.firebaseUid === decoded.uid,
    );

    if (!adminUser) {
      throw new ForbiddenException('No administrative access granted for this Firebase account');
    }

    if (adminUser.status === 'INACTIVE') {
      throw new ForbiddenException(
        'This administrative account has been deactivated. Contact Super Admin.',
      );
    }

    adminUser.lastActive = 'Just now';

    const token = createJwtToken({
      uid: adminUser.userId || adminUser.id,
      sub: adminUser.userId || adminUser.id,
      adminId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: Role.ADMIN,
      adminRole: adminUser.role,
      department: adminUser.department,
    });

    this.prisma.recordAuditEvent({
      actorId: adminUser.id,
      actorName: adminUser.name,
      actorRole: adminUser.role,
      actionType: 'ADMIN_SIGN_IN' as any,
      entityId: adminUser.id,
      entityName: adminUser.name,
      entityType: 'User' as any,
      ipAddress: clientIp || '127.0.0.1',
      userAgent: userAgent || 'KudiCart Admin Web (Firebase)',
      summary: `Firebase Admin sign-in successful for ${adminUser.name} (${adminUser.email})`,
      targetDescription: `Administrative Session Created (${adminUser.role})`,
      changePayload: {
        adminId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      },
    });

    return {
      success: true,
      message: 'Administrative authentication successful via Firebase',
      token,
      role: Role.ADMIN,
      adminRole: adminUser.role,
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: Role.ADMIN,
        adminRole: adminUser.role,
        department: adminUser.department,
        avatarInitials: adminUser.avatarInitials,
        assignedTerminal: adminUser.assignedTerminal,
      },
    };
  }

  async getProfile(userId: string) {
    const store = this.prisma.getStore();
    const admin = store.adminUsers.find(
      (u: any) => u.userId === userId || u.id === userId || u.email === userId,
    ) || store.adminUsers[0];

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: Role.ADMIN,
      adminRole: admin.role,
      department: admin.department,
      avatarInitials: admin.avatarInitials,
      assignedTerminal: admin.assignedTerminal,
      status: admin.status,
      lastActive: admin.lastActive,
    };
  }

  async updateProfile(userId: string, dto: UpdateAdminProfileDto) {
    const store = this.prisma.getStore();
    const admin = store.adminUsers.find(
      (u: any) => u.userId === userId || u.id === userId,
    );

    if (!admin) {
      throw new BadRequestException('Admin account not found');
    }

    if (dto.displayName) {
      admin.name = dto.displayName;
      admin.avatarInitials = dto.displayName
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }
    if (dto.email) {
      admin.email = dto.email.trim().toLowerCase();
    }

    return {
      success: true,
      message: 'Administrative profile updated successfully',
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: Role.ADMIN,
        adminRole: admin.role,
        department: admin.department,
        avatarInitials: admin.avatarInitials,
      },
    };
  }

  async logout(userId: string) {
    return {
      success: true,
      message: 'Administrative session terminated successfully',
    };
  }
}

