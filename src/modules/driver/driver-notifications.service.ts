import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DriverNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveDriverUserId(driverIdOrUserId: string): Promise<string> {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrUserId }, { userId: driverIdOrUserId }] },
      select: { userId: true },
    });
    return driver?.userId || driverIdOrUserId;
  }

  async getNotifications(driverId: string, category?: string) {
    this.ensureDbConnected();
    const userId = await this.resolveDriverUserId(driverId);

    const where: any = { userId };
    if (category && category !== 'ALL') {
      where.category = category;
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const formatted = notifications.map((n) => ({
      ...n,
      read: n.isRead,
      timestamp: n.createdAt.toISOString(),
    }));

    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return { notifications: formatted, unreadCount };
  }

  async markAsRead(driverId: string, notificationId: string) {
    this.ensureDbConnected();
    const userId = await this.resolveDriverUserId(driverId);

    const notif = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notif) {
      throw new NotFoundException('Notification not found');
    }
    if (notif.userId !== userId) {
      throw new ForbiddenException('You do not have permission to update this notification');
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true, notification: updated };
  }

  async markAllAsRead(driverId: string) {
    this.ensureDbConnected();
    const userId = await this.resolveDriverUserId(driverId);

    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true, message: 'All notifications marked as read' };
  }

  async deleteNotification(driverId: string, notificationId: string) {
    this.ensureDbConnected();
    const userId = await this.resolveDriverUserId(driverId);

    const notif = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notif) {
      throw new NotFoundException('Notification not found');
    }
    if (notif.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this notification');
    }

    await this.prisma.notification.delete({ where: { id: notificationId } });
    return { success: true, deletedId: notificationId };
  }

  async clearAll(driverId: string) {
    this.ensureDbConnected();
    const userId = await this.resolveDriverUserId(driverId);

    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });
    return { success: true, deletedCount: result.count };
  }
}
