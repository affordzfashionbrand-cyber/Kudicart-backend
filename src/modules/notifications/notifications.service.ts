import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { DeviceTokensService } from './device-tokens.service';
import { Role } from '../../common/enums/role.enum';

export interface PushNotificationPayload {
  recipientUserId?: string;
  recipientRole?: Role;
  title: string;
  body: string;
  category?: 'ORDER' | 'SYSTEM' | 'DELIVERY' | 'PAYMENT' | 'ALERT';
  data?: Record<string, string>;
  imageUrl?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly deviceTokensService: DeviceTokensService,
  ) {}

  /**
   * Dispatches a real push notification to registered devices of the recipient.
   */
  async sendNotification(payload: PushNotificationPayload): Promise<{
    delivered: boolean;
    recipientCount: number;
    successCount: number;
  }> {
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

    // Persist notification record in database or store
    await this.persistNotificationRecord(payload);

    if (targetTokens.length === 0) {
      this.logger.log(
        `[Notification] Recipient ${payload.recipientUserId || payload.recipientRole} has no registered push devices. Notification stored for polling.`,
      );
      return { delivered: false, recipientCount: 0, successCount: 0 };
    }

    // Redacted structured log
    const maskedCount = targetTokens.length;
    this.logger.log(
      `[PushDispatch] Sending "${payload.title}" to ${maskedCount} device(s) for ${payload.recipientUserId || payload.recipientRole}`,
    );

    const fcmResult = await this.firebaseAdmin.sendMulticastPush(targetTokens, {
      title: payload.title,
      body: payload.body,
      data: payload.data,
      imageUrl: payload.imageUrl,
    });

    // Cleanup dead/unregistered tokens
    if (fcmResult.invalidTokens.length > 0) {
      await this.deviceTokensService.deactivateInvalidTokens(fcmResult.invalidTokens);
    }

    return {
      delivered: fcmResult.successCount > 0,
      recipientCount: targetTokens.length,
      successCount: fcmResult.successCount,
    };
  }

  private async persistNotificationRecord(payload: PushNotificationPayload) {
    const store = this.prisma.getStore();
    const notificationItem = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      driverId: payload.recipientRole === Role.DRIVER ? payload.recipientUserId : undefined,
      customerId: payload.recipientRole === Role.CUSTOMER ? payload.recipientUserId : undefined,
      title: payload.title,
      body: payload.body,
      category: payload.category || 'SYSTEM',
      read: false,
      data: payload.data || {},
      createdAt: new Date().toISOString(),
    };

    if (!store.notifications) {
      store.notifications = [];
    }
    store.notifications.unshift(notificationItem);
  }
}

