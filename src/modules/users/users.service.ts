import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { buildPhoneLookupCandidates, normalizeStoredPhone } from '../../common/utils/phone.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  async resolveCanonicalUser(currentUser: AuthenticatedUser) {
    this.ensureDbConnected();

    const phoneCandidates = buildPhoneLookupCandidates(currentUser.phone);
    const orClauses: any[] = [{ id: currentUser.id }];
    if (currentUser.firebaseUid) {
      orClauses.push({ firebaseUid: currentUser.firebaseUid });
    }
    if (currentUser.email) {
      orClauses.push({ email: currentUser.email.trim().toLowerCase() });
    }
    if (phoneCandidates.length > 0) {
      orClauses.push(...phoneCandidates.map((phone) => ({ phone })));
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: orClauses },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (existing) {
      if (existing.status !== 'ACTIVE') {
        throw new ForbiddenException('Account is inactive or suspended.');
      }
      return existing;
    }

    const normalizedEmail = currentUser.email ? currentUser.email.trim().toLowerCase() : null;
    const normalizedPhone = normalizeStoredPhone(currentUser.phone);

    try {
      return await this.prisma.user.create({
        data: {
          id: currentUser.id.startsWith('usr-') ? currentUser.id : `usr-${randomUUID().slice(0, 8)}`,
          firebaseUid: currentUser.firebaseUid || `fb-${randomUUID().slice(0, 10)}`,
          phone: normalizedPhone,
          email: normalizedEmail,
          name: currentUser.name?.trim() || 'Affordz Customer',
          avatar: currentUser.avatar || null,
          role: (currentUser.role as any) || 'CUSTOMER',
          status: 'ACTIVE',
        },
        include: {
          addresses: {
            orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
          },
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const retryUser = await this.prisma.user.findFirst({
          where: { OR: orClauses },
          include: {
            addresses: {
              orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
            },
          },
        });
        if (retryUser) {
          return retryUser;
        }
      }
      throw new BadRequestException(`Failed to resolve user profile: ${err?.message || 'Unknown error'}`);
    }
  }

  async getProfile(userId: string, currentUser?: AuthenticatedUser) {
    this.ensureDbConnected();

    let user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (!user && currentUser) {
      user = await this.resolveCanonicalUser(currentUser);
    }

    if (!user) {
      throw new NotFoundException(`User record "${userId}" not found.`);
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended.');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
      addresses: user.addresses || [],
    };
  }

  async updateProfile(userId: string, dto: UpdateUserDto, currentUser?: AuthenticatedUser) {
    this.ensureDbConnected();

    let user: any = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user && currentUser) {
      user = await this.resolveCanonicalUser(currentUser);
    }

    if (!user) {
      throw new NotFoundException(`User record "${userId}" not found.`);
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is inactive or suspended. Profile updates are not permitted.');
    }

    const updateData: Record<string, any> = {};

    if (dto.name !== undefined) {
      const trimmed = typeof dto.name === 'string' ? dto.name.trim() : '';
      if (!trimmed) {
        throw new BadRequestException('Name cannot be empty.');
      }
      updateData.name = trimmed;
    }

    if (dto.email !== undefined) {
      const trimmed = typeof dto.email === 'string' ? dto.email.trim() : '';
      updateData.email = trimmed ? trimmed.toLowerCase() : null;
    }

    if (dto.phone !== undefined) {
      const trimmed = typeof dto.phone === 'string' ? dto.phone.trim() : '';
      updateData.phone = trimmed ? trimmed : null;
    }

    if (dto.avatar !== undefined) {
      updateData.avatar = dto.avatar && typeof dto.avatar === 'string' && dto.avatar.trim()
        ? dto.avatar.trim()
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
      };
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });

      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        avatar: updated.avatar,
        role: updated.role,
        status: updated.status,
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Email address or phone number is already linked to another account.');
      }
      throw new BadRequestException(`Failed to update profile: ${err?.message || 'Unknown error'}`);
    }
  }

  async deactivateAccount(userId: string) {
    this.ensureDbConnected();

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User record "${userId}" not found.`);
    }

    if (user.status === 'DELETED') {
      return {
        success: true,
        message: 'Account has already been deactivated.',
      };
    }

    const anonymizedUid = `deleted:${user.id}:${Date.now()}`;

    await this.prisma.$transaction([
      this.prisma.deviceToken.updateMany({
        where: { userId: user.id },
        data: { isActive: false },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          status: 'DELETED',
          name: 'Deleted User',
          email: null,
          phone: null,
          avatar: null,
          firebaseUid: anonymizedUid,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: 'USER_SELF_DELETED',
          entityType: 'User',
          entityId: user.id,
          details: 'User requested self-service account deactivation and PII anonymization',
        },
      }),
    ]);

    return {
      success: true,
      message: 'Account deactivated and personal profile details anonymized.',
    };
  }
}
