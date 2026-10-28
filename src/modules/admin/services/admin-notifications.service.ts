import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { BroadcastNotificationDto } from '../dto/admin-domain.dto';

@Injectable()
export class AdminNotificationsService {
  constructor(private prisma: PrismaService) {}

  async listNotifications(query: AdminQueryDto) {
    const store = this.prisma.getStore();
    let notifications = store.operationalNotifications || [];

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      notifications = notifications.filter(
        (n: any) =>
          n.title.toLowerCase().includes(q) ||
          n.messagePreview.toLowerCase().includes(q) ||
          n.recipientName.toLowerCase().includes(q) ||
          n.recipientId.toLowerCase().includes(q),
      );
    }

    if (query.category && query.category !== 'ALL') {
      notifications = notifications.filter((n: any) => n.category === query.category);
    }

    if (query.role && query.role !== 'ALL') {
      notifications = notifications.filter((n: any) => n.targetRole === query.role);
    }

    if (query.status && query.status !== 'ALL') {
      notifications = notifications.filter((n: any) => n.deliveryStatus === query.status);
    }

    const unreadCount = notifications.filter((n: any) => !n.read).length;

    return {
      data: notifications,
      total: notifications.length,
      unreadCount,
    };
  }

  async markAsRead(id: string) {
    const store = this.prisma.getStore();
    const notification = (store.operationalNotifications || []).find((n: any) => n.id === id);

    if (!notification) {
      throw new NotFoundException(`Notification record '${id}' was not found.`);
    }

    notification.read = true;

    return {
      success: true,
      message: `Notification #${id} marked as read.`,
      notification,
    };
  }

  async broadcast(
    dto: BroadcastNotificationDto,
    actorId?: string,
    actorName?: string,
  ) {
    const store = this.prisma.getStore();
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const newNotif = {
      id: `NOTIF-${Date.now().toString().slice(-4)}`,
      timestamp: timeStr,
      timestampFull: now.toLocaleString(),
      category: 'System Alerts' as const,
      targetRole: (dto.targetRole || 'Central Admin') as any,
      recipientName: dto.scope || 'All Operational Hubs',
      recipientId: 'BROADCAST',
      title: dto.title,
      messagePreview: dto.note ? `${dto.note.slice(0, 80)}...` : dto.title,
      messageFull: dto.note || dto.title,
      deliveryStatus: 'Delivered' as const,
      deliveryChannel: 'In-App Dispatch' as const,
      read: false,
      priority: (dto.severity === 'Operational Warning' ? 'Warning' : 'Informational') as any,
      dispatchedHub: dto.scope || 'Central Ops HQ',
    };

    if (!store.operationalNotifications) store.operationalNotifications = [];
    store.operationalNotifications.unshift(newNotif);

    this.prisma.recordAuditEvent({
      actorId,
      actorName,
      actionType: 'NOTIFICATION_BROADCAST' as any,
      entityId: newNotif.id,
      entityName: newNotif.title,
      entityType: 'Order' as any,
      summary: `Broadcast operational announcement '${newNotif.title}' to ${newNotif.recipientName}`,
      targetDescription: `System Broadcast Notification`,
      changePayload: {
        title: dto.title,
        scope: dto.scope,
        severity: dto.severity,
      },
      entityLink: `/admin/notifications`,
    });

    return {
      success: true,
      message: 'Operational broadcast announcement dispatched successfully.',
      notification: newNotif,
    };
  }
}

