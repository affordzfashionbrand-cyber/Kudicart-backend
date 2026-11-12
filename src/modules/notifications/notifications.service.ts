import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { DeviceTokensService } from './device-tokens.service';
import { Role } from '../../common/enums/role.enum';

export interface PushNotificationPayload {
  recipientUserId?: string;
  recipientRole?: Role | string;
  title: string;
  body: string;
  category?: 'ORDER' | 'SYSTEM' | 'DELIVERY' | 'PAYMENT' | 'ALERT';
  data?: Record<string, string>;
  imageUrl?: string;
  channelId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly deviceTokensService: DeviceTokensService,
  ) {}

  private normalizeDataMap(data?: Record<string, any>): Record<string, string> | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        out[k] = typeof v === 'string' ? v : String(v);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  async sendNotification(payload: PushNotificationPayload): Promise<{
    delivered: boolean;
    tokenCount: number;
    successCount: number;
    failureCount: number;
    notificationId?: string;
  }> {
    let persistedId: string | undefined;
    const safeData = this.normalizeDataMap(payload.data);

    if (this.prisma.isConnectedToDb) {
      try {
        const normalizedRole =
          payload.recipientRole &&
          Object.values(Role).includes(payload.recipientRole as Role)
            ? (payload.recipientRole as any)
            : null;

        const created = await this.prisma.notification.create({
          data: {
            userId: payload.recipientUserId || null,
            role: normalizedRole,
            orderId: safeData?.orderId || null,
            category: payload.category || 'ORDER',
            title: payload.title,
            body: payload.body,
            data: safeData ?? undefined,
            isRead: false,
          },
        });
        persistedId = created.id;
      } catch (err: any) {
        this.logger.warn(
          `Failed to persist Postgres Notification record: ${err?.message}`,
        );
      }
    }

    let targetTokens: string[] = [];
    if (payload.recipientUserId) {
      targetTokens = await this.deviceTokensService.getActiveTokensForUser(
        payload.recipientUserId,
        payload.recipientRole,
      );
    } else if (payload.recipientRole) {
      targetTokens = await this.deviceTokensService.getActiveTokensForRole(
        payload.recipientRole,
      );
    }

    if (targetTokens.length === 0) {
      return {
        delivered: Boolean(persistedId),
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        notificationId: persistedId,
      };
    }

    try {
      const channelId =
        payload.channelId ||
        (payload.recipientRole === Role.DRIVER
          ? 'kudicart_driver_alerts'
          : 'affordz_critical_alerts');

      const fcmResult = await this.firebaseAdmin.sendMulticastPush(targetTokens, {
        title: payload.title,
        body: payload.body,
        data: safeData,
        imageUrl: payload.imageUrl,
        channelId,
      });

      if (fcmResult.invalidTokens && fcmResult.invalidTokens.length > 0) {
        await this.deviceTokensService.deactivateInvalidTokens(fcmResult.invalidTokens);
      }

      return {
        delivered: fcmResult.successCount > 0 || Boolean(persistedId),
        tokenCount: targetTokens.length,
        successCount: fcmResult.successCount,
        failureCount: fcmResult.failureCount,
        notificationId: persistedId,
      };
    } catch (err: any) {
      this.logger.warn(`FCM dispatch error: ${err?.message}`);
      return {
        delivered: Boolean(persistedId),
        tokenCount: targetTokens.length,
        successCount: 0,
        failureCount: targetTokens.length,
        notificationId: persistedId,
      };
    }
  }

  async listForUser(
    userId: string,
    role: string,
    options?: { limit?: number; unreadOnly?: boolean; category?: string },
  ) {
    if (!this.prisma.isConnectedToDb) {
      return { items: [], unreadCount: 0, total: 0 };
    }

    const normalizedRole = Object.values(Role).includes(role as Role) ? (role as any) : null;
    const ownerFilter = {
      OR: [
        { userId },
        ...(normalizedRole ? [{ userId: null, role: normalizedRole }] : []),
      ],
    };

    const where: any = {
      ...ownerFilter,
      ...(options?.unreadOnly ? { isRead: false } : {}),
      ...(options?.category ? { category: options.category } : {}),
    };

    const take = Math.min(Math.max(Number(options?.limit || 50), 1), 100);

    const [items, unreadCount, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({
        where: { ...ownerFilter, isRead: false },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, unreadCount, total };
  }

  async markAsReadForUser(notificationId: string, userId: string, role: string) {
    if (!this.prisma.isConnectedToDb) {
      throw new NotFoundException('Notification not found');
    }

    const normalizedRole = Object.values(Role).includes(role as Role) ? (role as any) : null;
    const existing = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        OR: [
          { userId },
          ...(normalizedRole ? [{ userId: null, role: normalizedRole }] : []),
        ],
      },
    });

    if (!existing) {
      throw new NotFoundException(`Notification '${notificationId}' not found`);
    }

    const updated = await this.prisma.notification.update({
      where: { id: existing.id },
      data: {
        isRead: true,
        readAt: existing.readAt || new Date(),
      },
    });

    return { success: true, notification: updated };
  }

  async markAllAsReadForUser(userId: string, role: string) {
    if (!this.prisma.isConnectedToDb) {
      return { success: true, updatedCount: 0 };
    }

    const normalizedRole = Object.values(Role).includes(role as Role) ? (role as any) : null;
    const res = await this.prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [
          { userId },
          ...(normalizedRole ? [{ userId: null, role: normalizedRole }] : []),
        ],
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { success: true, updatedCount: res.count };
  }
}
