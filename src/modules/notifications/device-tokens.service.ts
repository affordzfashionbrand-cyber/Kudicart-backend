import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerToken(
    userId: string,
    role: Role | string,
    platform: 'android' | 'ios' | 'web' | string,
    token: string,
  ) {
    if (!userId || !token || !token.trim()) {
      throw new BadRequestException('Valid userId and device token are required.');
    }

    const normalizedRole = Object.values(Role).includes(role as Role)
      ? (role as Role)
      : Role.CUSTOMER;
    const normalizedToken = token.trim();
    const normalizedPlatform = ['android', 'ios', 'web'].includes(platform)
      ? platform
      : 'android';

    if (!this.prisma.isConnectedToDb) {
      throw new BadRequestException('Database connection is required for device registration.');
    }

    const saved = await this.prisma.deviceToken.upsert({
      where: { token: normalizedToken },
      create: {
        userId,
        role: normalizedRole as any,
        platform: normalizedPlatform,
        token: normalizedToken,
        isActive: true,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        role: normalizedRole as any,
        platform: normalizedPlatform,
        isActive: true,
        lastSeenAt: new Date(),
      },
    });

    this.logger.log(
      `Registered active FCM token for user=${userId} role=${normalizedRole} platform=${normalizedPlatform}`,
    );

    return {
      success: true,
      id: saved.id,
      userId: saved.userId,
      role: saved.role,
      platform: saved.platform,
      token: saved.token,
      isActive: saved.isActive,
    };
  }

  async unregisterToken(userId: string, token: string) {
    if (!userId || !token || !token.trim()) {
      throw new BadRequestException('Valid userId and device token are required.');
    }

    if (!this.prisma.isConnectedToDb) {
      return { success: false, removedCount: 0 };
    }

    const res = await this.prisma.deviceToken.updateMany({
      where: {
        userId,
        token: token.trim(),
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    return {
      success: true,
      deactivatedCount: res.count,
    };
  }

  async getActiveTokensForUser(userId: string, role?: Role | string): Promise<string[]> {
    if (!userId || !this.prisma.isConnectedToDb) {
      return [];
    }

    const rows = await this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
        ...(role ? { role: role as any } : {}),
      },
      select: { token: true },
    });

    return Array.from(new Set(rows.map((r) => r.token).filter(Boolean)));
  }

  async getActiveTokensForRole(role: Role | string): Promise<string[]> {
    if (!role || !this.prisma.isConnectedToDb) {
      return [];
    }

    const rows = await this.prisma.deviceToken.findMany({
      where: {
        role: role as any,
        isActive: true,
      },
      select: { token: true },
    });

    return Array.from(new Set(rows.map((r) => r.token).filter(Boolean)));
  }

  async deactivateInvalidTokens(tokens: string[]): Promise<{ deactivatedCount: number }> {
    const clean = Array.from(new Set((tokens || []).map((t) => t?.trim()).filter(Boolean)));
    if (clean.length === 0 || !this.prisma.isConnectedToDb) {
      return { deactivatedCount: 0 };
    }

    const res = await this.prisma.deviceToken.updateMany({
      where: { token: { in: clean } },
      data: { isActive: false },
    });

    if (res.count > 0) {
      this.logger.warn(`Deactivated ${res.count} stale/invalid FCM token(s).`);
    }

    return { deactivatedCount: res.count };
  }
}
