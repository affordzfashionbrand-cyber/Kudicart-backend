import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Role } from '../../../common/enums/role.enum';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { BroadcastNotificationDto } from '../dto/admin-domain.dto';

function mapNotificationCategory(rawCategory: string): string {
  switch ((rawCategory || '').toUpperCase()) {
    case 'KYC':
      return 'KYC';
    case 'DELIVERY':
    case 'ASSIGNMENT':
      return 'Assignment';
    case 'ORDER':
    case 'PAYMENT':
    case 'ORDER UPDATES':
    case 'ORDER_UPDATES':
      return 'Order Updates';
    case 'SYSTEM':
    case 'ALERT':
    case 'SYSTEM ALERTS':
    case 'SYSTEM_ALERTS':
      return 'System Alerts';
    default:
      return rawCategory || 'System Alerts';
  }
}

function mapRoleLabel(role: string | null): string {
  switch ((role || '').toUpperCase()) {
    case Role.DRIVER:
      return 'Driver';
    case Role.CUSTOMER:
      return 'Customer';
    case Role.VENDOR:
      return 'Vendor';
    case Role.ADMIN:
      return 'Central Admin';
    default:
      return 'Central Admin';
  }
}

function resolveBroadcastRole(scope?: string, targetRole?: string): Role {
  const combined = `${scope || ''} ${targetRole || ''}`.toLowerCase();
  if (combined.includes('driver') || combined.includes('fleet')) return Role.DRIVER;
  if (combined.includes('vendor') || combined.includes('merchant') || combined.includes('boutique')) {
    return Role.VENDOR;
  }
  if (combined.includes('customer')) return Role.CUSTOMER;
  return Role.ADMIN;
}

function mapNotificationRow(row: any) {
  const payload =
    row.data && typeof row.data === 'object' ? (row.data as Record<string, any>) : {};
  const targetRole = mapRoleLabel(row.role);

  return {
    id: row.id,
    timestamp: row.createdAt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    timestampFull: row.createdAt.toISOString(),
    category: mapNotificationCategory(row.category),
    targetRole,
    recipientName:
      payload.recipientName || row.user?.name || row.user?.email || targetRole,
    recipientId: row.userId || targetRole,
    title: row.title,
    messagePreview: row.body.slice(0, 120),
    messageFull: row.body,
    deliveryStatus: 'Delivered' as const,
    deliveryChannel: payload.channel || 'Push + In-App',
    read: Boolean(row.isRead),
    priority:
      payload.priority === 'Critical'
        ? 'Critical'
        : payload.priority === 'Warning' || payload.priority === 'Operational Warning'
          ? 'Warning'
          : 'Informational',
    dispatchedHub: payload.scope || 'Central Ops HQ',
    orderId: row.orderId || payload.orderId || undefined,
  };
}

@Injectable()
export class AdminNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listNotifications(query: AdminQueryDto) {
    if (!this.prisma.isConnectedToDb) {
      return { data: [], total: 0, unreadCount: 0 };
    }

    const take = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const where: any = {};

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { body: { contains: s, mode: 'insensitive' } },
        { userId: { contains: s, mode: 'insensitive' } },
        { orderId: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query.role && query.role !== 'ALL') {
      where.role = resolveBroadcastRole(undefined, query.role);
    }

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);

    let mapped = rows.map(mapNotificationRow);

    if (query.category && query.category !== 'ALL') {
      mapped = mapped.filter((n) => n.category === query.category);
    }

    return {
      data: mapped,
      total: query.category && query.category !== 'ALL' ? mapped.length : total,
      unreadCount,
    };
  }

  async markAsRead(id: string) {
    if (!this.prisma.isConnectedToDb) {
      throw new NotFoundException(`Notification record '${id}' was not found.`);
    }

    const existing = await this.prisma.notification.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!existing) {
      throw new NotFoundException(`Notification record '${id}' was not found.`);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: existing.readAt || new Date(),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return {
      success: true,
      message: `Notification #${id} marked as read.`,
      notification: mapNotificationRow(updated),
    };
  }

  async broadcast(
    dto: BroadcastNotificationDto,
    actorId?: string,
    actorName?: string,
  ) {
    const recipientRole = resolveBroadcastRole(dto.scope, dto.targetRole);
    const body = dto.note?.trim() || dto.message?.trim() || dto.title.trim();

    const pushResult = await this.notificationsService.sendNotification({
      recipientRole,
      title: dto.title.trim(),
      body,
      category: 'ALERT',
      data: {
        scope: dto.scope || 'All Hubs & Fleets',
        priority: dto.severity || 'Informational',
        recipientName: dto.scope || mapRoleLabel(recipientRole),
        channel: 'Push + In-App',
      },
    });

    if (this.prisma.isConnectedToDb) {
      await this.prisma.auditLog
        .create({
          data: {
            userId: actorId || null,
            userEmail: actorName || null,
            userRole: 'ADMIN',
            action: 'NOTIFICATION_BROADCAST',
            entityType: 'Notification',
            entityId: pushResult.notificationId || 'BROADCAST',
            details: JSON.stringify({
              title: dto.title.trim(),
              scope: dto.scope || 'All Hubs & Fleets',
              severity: dto.severity || 'Informational',
              recipientRole,
              tokenCount: pushResult.tokenCount,
            }),
          },
        })
        .catch(() => {});
    }

    const saved =
      pushResult.notificationId && this.prisma.isConnectedToDb
        ? await this.prisma.notification.findUnique({
            where: { id: pushResult.notificationId },
            include: { user: { select: { id: true, name: true, email: true } } },
          })
        : null;

    const mapped = saved
      ? mapNotificationRow(saved)
      : mapNotificationRow({
          id: pushResult.notificationId || `NOTIF-${Date.now()}`,
          userId: null,
          role: recipientRole,
          orderId: null,
          category: 'ALERT',
          title: dto.title.trim(),
          body,
          data: {
            scope: dto.scope || 'All Hubs & Fleets',
            priority: dto.severity || 'Informational',
            recipientName: dto.scope || mapRoleLabel(recipientRole),
          },
          isRead: false,
          createdAt: new Date(),
        });

    return {
      success: true,
      message: 'Operational broadcast announcement dispatched successfully.',
      notification: mapped,
    };
  }
}
