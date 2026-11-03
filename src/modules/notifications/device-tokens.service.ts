import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers or updates an FCM device token for an authenticated user.
   */
  async registerToken(
    userId: string,
    role: Role | string,
    platform: 'android' | 'ios' | 'web' | string,
    token: string,
  ) {
    if (!token || !userId) {
      return { success: false, message: 'User ID and FCM token are required' };
    }

    const maskedToken = `${token.slice(0, 8)}...${token.slice(-6)}`;

    // Database persistence
    if (this.prisma.isConnectedToDb) {
      try {
        await this.prisma.deviceToken.upsert({
          where: { token },
          create: {
            userId,
            role: role as any,
            platform,
            token,
            isActive: true,
            lastSeenAt: new Date(),
          },
          update: {
            userId,
            role: role as any,
            platform,
            isActive: true,
            lastSeenAt: new Date(),
          },
        });
        this.logger.log(`Registered device token ${maskedToken} for user ${userId} (${role}) in DB`);
        return { success: true, registered: true };
      } catch (err: any) {
        this.logger.warn(`Failed to persist device token to DB: ${err.message}. Saving to fallback store.`);
      }
    }

    // In-memory store mirror
    const store = this.prisma.getStore();
    if (!store.deviceTokens) {
      store.deviceTokens = [];
    }

    const existing = store.deviceTokens.find((t: any) => t.token === token);
    if (existing) {
      existing.userId = userId;
      existing.role = role;
      existing.platform = platform;
      existing.isActive = true;
      existing.lastSeenAt = new Date().toISOString();
    } else {
      store.deviceTokens.push({
        id: `dt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        userId,
        role,
        platform,
        token,
        isActive: true,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
    }

    this.logger.log(`Registered device token ${maskedToken} for user ${userId} (${role}) in store`);
    return { success: true, registered: true };
  }

  /**
   * Unregisters (deactivates) an FCM device token upon logout.
   */
  async unregisterToken(userId: string, token: string) {
    if (!token) return { success: false };

    if (this.prisma.isConnectedToDb) {
      try {
        await this.prisma.deviceToken.updateMany({
          where: { token, userId },
          data: { isActive: false, updatedAt: new Date() },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to deactivate device token in DB: ${err.message}`);
      }
    }

    const store = this.prisma.getStore();
    if (store.deviceTokens) {
      const entry = store.deviceTokens.find((t: any) => t.token === token && t.userId === userId);
      if (entry) {
        entry.isActive = false;
      }
    }

    return { success: true, unregistered: true };
  }

  /**
   * Retrieves all active device tokens for a given user.
   */
  async getActiveTokensForUser(userId: string, role?: Role): Promise<string[]> {
    if (this.prisma.isConnectedToDb) {
      try {
        const records = await this.prisma.deviceToken.findMany({
          where: {
            userId,
            isActive: true,
            ...(role ? { role: role as any } : {}),
          },
          select: { token: true },
        });
        return records.map((r) => r.token);
      } catch (err: any) {
        this.logger.warn(`Failed to fetch active tokens from DB: ${err.message}`);
      }
    }

    const store = this.prisma.getStore();
    if (!store.deviceTokens) return [];
    return store.deviceTokens
      .filter((t: any) => t.userId === userId && t.isActive && (!role || t.role === role))
      .map((t: any) => t.token);
  }

  /**
   * Retrieves all active device tokens for an entire role (e.g. all DRIVERs).
   */
  async getActiveTokensForRole(role: Role): Promise<string[]> {
    if (this.prisma.isConnectedToDb) {
      try {
        const records = await this.prisma.deviceToken.findMany({
          where: { role: role as any, isActive: true },
          select: { token: true },
        });
        return records.map((r) => r.token);
      } catch (err: any) {
        this.logger.warn(`Failed to fetch role tokens from DB: ${err.message}`);
      }
    }

    const store = this.prisma.getStore();
    if (!store.deviceTokens) return [];
    return store.deviceTokens
      .filter((t: any) => t.role === role && t.isActive)
      .map((t: any) => t.token);
  }

  /**
   * Deactivates tokens that FCM reported as invalid or unregistered.
   */
  async deactivateInvalidTokens(tokens: string[]) {
    if (!tokens || tokens.length === 0) return;

    if (this.prisma.isConnectedToDb) {
      try {
        await this.prisma.deviceToken.updateMany({
          where: { token: { in: tokens } },
          data: { isActive: false, updatedAt: new Date() },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to deactivate invalid tokens in DB: ${err.message}`);
      }
    }

    const store = this.prisma.getStore();
    if (store.deviceTokens) {
      store.deviceTokens.forEach((t: any) => {
        if (tokens.includes(t.token)) {
          t.isActive = false;
        }
      });
    }
  }
}

