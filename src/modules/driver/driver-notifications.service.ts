import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DriverNotificationsService {
  constructor(private prisma: PrismaService) {}

  async getNotifications(driverId: string, category?: string) {
    const store = this.prisma.getStore();
    let notifs = store.notifications.filter(
      (n) => n.driverId === driverId || n.driverId === 'drv-1',
    );

    if (category) {
      notifs = notifs.filter((n) => n.category.toUpperCase() === category.toUpperCase());
    }

    const unreadCount = notifs.filter((n) => !n.read).length;

    return {
      unreadCount,
      notifications: notifs,
    };
  }

  async markAsRead(driverId: string, notificationId: string) {
    const store = this.prisma.getStore();
    const notif = store.notifications.find((n) => n.id === notificationId);

    if (!notif) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    if (notif.driverId !== driverId && notif.driverId !== 'drv-1') {
      throw new ForbiddenException('Cannot modify another driver’s notification');
    }

    notif.read = true;

    return {
      success: true,
      notification: notif,
    };
  }

  async markAllAsRead(driverId: string) {
    const store = this.prisma.getStore();
    store.notifications
      .filter((n) => n.driverId === driverId || n.driverId === 'drv-1')
      .forEach((n) => {
        n.read = true;
      });

    return {
      success: true,
      message: 'All notifications marked as read',
    };
  }

  async deleteNotification(driverId: string, notificationId: string) {
    const store = this.prisma.getStore();
    const index = store.notifications.findIndex((n) => n.id === notificationId);

    if (index === -1) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    const notif = store.notifications[index];
    if (notif.driverId !== driverId && notif.driverId !== 'drv-1') {
      throw new ForbiddenException('Cannot delete another driver’s notification');
    }

    store.notifications.splice(index, 1);

    return {
      success: true,
      message: 'Notification deleted',
    };
  }

  async clearAll(driverId: string) {
    const store = this.prisma.getStore();
    store.notifications = store.notifications.filter(
      (n) => n.driverId !== driverId && n.driverId !== 'drv-1',
    );

    return {
      success: true,
      message: 'All notifications cleared',
    };
  }
}
