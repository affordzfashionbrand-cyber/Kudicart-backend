import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Role } from '../../../common/enums/role.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  AFFORDZ_NOTIFICATIONS_QUEUE,
  QueueJobType,
  getRedisConnectionOptions,
} from '../queue.constants';
import { QueueService } from '../queue.service';

@Injectable()
export class NotificationsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit() {
    this.queueService.registerNotificationHandler((job) =>
      this.processNotificationJob(job),
    );

    const connection = getRedisConnectionOptions();
    if (!connection) {
      return;
    }

    this.worker = new Worker(
      AFFORDZ_NOTIFICATIONS_QUEUE,
      async (job: Job) => this.processNotificationJob(job),
      { connection, concurrency: 5 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[BullMQ] Notification job ${job?.name} (${job?.id}) failed: ${err?.message}`,
      );
    });

    this.logger.log(
      `NotificationsProcessor BullMQ worker attached to '${AFFORDZ_NOTIFICATIONS_QUEUE}'`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.worker = undefined;
  }

  private toStringMap(data: Record<string, any>, extra: Record<string, string>) {
    const out: Record<string, string> = { ...extra };
    if (data?.orderId) out.orderId = String(data.orderId);
    if (data?.orderNumber) out.orderNumber = String(data.orderNumber);
    if (data?.status) out.status = String(data.status);
    if (data?.checkoutGroupId) out.checkoutGroupId = String(data.checkoutGroupId);
    return out;
  }

  async processNotificationJob(job: { id?: string; name: string; data: any }) {
    const name = job.name;
    const data = job.data || {};

    switch (name) {
      case QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.driverUserId || data.userId || data.driverId,
          recipientRole: Role.DRIVER,
          title: data.title || 'New Delivery Assigned',
          body:
            data.message ||
            `Order #${data.orderNumber || data.orderId} has been assigned to you.`,
          category: 'DELIVERY',
          data: this.toStringMap(data, { event: name, status: 'ASSIGNED' }),
        });

      case QueueJobType.ASSIGNMENT_CANCELLATION_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.driverUserId || data.userId || data.driverId,
          recipientRole: Role.DRIVER,
          title: data.title || 'Delivery Assignment Cancelled',
          body:
            data.message ||
            `Assignment for order #${data.orderNumber || data.orderId} was cancelled.`,
          category: 'DELIVERY',
          data: this.toStringMap(data, { event: name }),
        });

      case QueueJobType.VENDOR_ORDER_NOTIFICATION:
      case QueueJobType.VENDOR_ORDER_CANCELLED:
        return this.notificationsService.sendNotification({
          recipientUserId: data.vendorUserId || data.userId,
          recipientRole: Role.VENDOR,
          title:
            data.title ||
            (name === QueueJobType.VENDOR_ORDER_CANCELLED
              ? 'Order Cancelled'
              : 'New Customer Order Received'),
          body:
            data.message ||
            `Order update for #${data.orderNumber || data.orderId}`,
          category: 'ORDER',
          data: this.toStringMap(data, { event: name }),
        });

      case QueueJobType.PAYMENT_CAPTURED_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.userId || data.customerId,
          recipientRole: Role.CUSTOMER,
          title: data.title || 'Payment Confirmed',
          body: data.message || 'Your payment was captured successfully.',
          category: 'PAYMENT',
          data: this.toStringMap(data, { event: name }),
        });

      case QueueJobType.TRY_AND_BUY_SELECTION_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.driverUserId || data.userId || data.driverId,
          recipientRole: (data.recipientRole as Role) || Role.DRIVER,
          title: data.title || 'Customer Submitted Try & Buy Selection',
          body:
            data.message ||
            `Customer updated Try & Buy choices for order #${data.orderNumber || data.orderId}.`,
          category: 'DELIVERY',
          data: this.toStringMap(data, { event: name }),
        });

      case QueueJobType.TRY_AND_BUY_HANDOVER:
      case QueueJobType.TRY_AND_BUY_DECISION:
      case QueueJobType.TRY_AND_BUY_EXPIRY_CHECK:
        return this.notificationsService.sendNotification({
          recipientUserId: data.userId || data.customerId || data.driverId,
          recipientRole: (data.recipientRole as Role) || Role.CUSTOMER,
          title: data.title || 'Try & Buy Update',
          body: data.message || `Try & Buy update for order #${data.orderNumber || data.orderId}`,
          category: 'DELIVERY',
          data: this.toStringMap(data, { event: name }),
        });

      case QueueJobType.ORDER_STATUS_NOTIFICATION:
      case QueueJobType.CUSTOMER_ORDER_PLACED:
      case QueueJobType.CUSTOMER_ORDER_DELIVERED:
      case 'ORDER_ARRIVED':
        return this.notificationsService.sendNotification({
          recipientUserId: data.userId || data.customerId,
          recipientRole: (data.recipientRole as Role) || Role.CUSTOMER,
          title: data.title || `Order #${data.orderNumber || data.orderId} Update`,
          body:
            data.message ||
            `Order status updated to ${data.status || 'updated'}.`,
          category: name === 'ORDER_ARRIVED' ? 'DELIVERY' : 'ORDER',
          data: this.toStringMap(data, { event: name }),
        });

      default:
        this.logger.log(`Notification worker skipped non-push event: ${name}`);
        return { handled: true, skippedPush: true, event: name };
    }
  }
}
