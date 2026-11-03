import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { KUDICART_NOTIFICATIONS_QUEUE, QueueJobType } from '../queue.constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { Role } from '../../../common/enums/role.enum';

@Injectable()
export class NotificationsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private worker: Worker | null = null;

  constructor(private readonly notificationsService: NotificationsService) {}

  onModuleInit() {
    const redisHost = process.env.REDIS_HOST;
    const redisPort = Number(process.env.REDIS_PORT) || 6379;
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    if (redisHost || process.env.REDIS_ENABLED === 'true') {
      try {
        const connection = {
          host: redisHost || '127.0.0.1',
          port: redisPort,
          password: redisPassword,
          maxRetriesPerRequest: null,
        };

        this.worker = new Worker(
          KUDICART_NOTIFICATIONS_QUEUE,
          async (job: Job) => {
            return this.processJob(job);
          },
          {
            connection,
            concurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
            limiter: {
              max: 50,
              duration: 1000,
            },
          },
        );

        this.worker.on('completed', (job: Job) => {
          this.logger.log(`[Worker:Notifications] Job ${job.id} (${job.name}) completed successfully`);
        });

        this.worker.on('failed', (job: Job | undefined, err: Error) => {
          this.logger.error(
            `[Worker:Notifications] Job ${job?.id} (${job?.name}) failed: ${err.message}. Attempts: ${job?.attemptsMade}/${job?.opts.attempts || 3}`,
            err.stack,
          );
        });

        this.logger.log(`BullMQ Worker registered for queue: ${KUDICART_NOTIFICATIONS_QUEUE}`);
      } catch (err: any) {
        this.logger.warn(`Could not start BullMQ Notifications Worker: ${err.message}`);
      }
    } else {
      this.logger.log('Notifications BullMQ Worker standing by (REDIS_HOST not configured)');
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log(`Closed Notifications Worker for ${KUDICART_NOTIFICATIONS_QUEUE}`);
    }
  }

  /**
   * Dispatches and processes an individual notification job.
   */
  async processJob(job: Job) {
    const { name, data } = job;
    this.logger.log(`[Worker] Processing notification job: ${name} (Job ID: ${job.id})`);

    switch (name) {
      case QueueJobType.ORDER_STATUS_NOTIFICATION:
      case QueueJobType.CUSTOMER_ORDER_PLACED:
      case QueueJobType.CUSTOMER_ORDER_DELIVERED:
        return this.notificationsService.sendNotification({
          recipientUserId: data.customerId || data.userId,
          recipientRole: Role.CUSTOMER,
          title: data.title || 'Order Update',
          body: data.message || `Order status updated to ${data.status}`,
          category: 'ORDER',
          data: { orderId: String(data.orderId || ''), status: String(data.status || '') },
        });

      case QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.driverId || data.userId,
          recipientRole: Role.DRIVER,
          title: data.title || 'New Delivery Assignment',
          body: data.message || `New delivery offer available for order ${data.orderNumber || data.orderId}`,
          category: 'DELIVERY',
          data: { orderId: String(data.orderId || ''), status: 'ASSIGNED' },
        });

      case QueueJobType.ASSIGNMENT_CANCELLATION_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.driverId || data.userId,
          recipientRole: Role.DRIVER,
          title: data.title || 'Assignment Cancelled',
          body: data.message || `Order assignment ${data.orderNumber || data.orderId} was cancelled`,
          category: 'DELIVERY',
          data: { orderId: String(data.orderId || '') },
        });

      case QueueJobType.VENDOR_ORDER_NOTIFICATION:
        return this.notificationsService.sendNotification({
          recipientUserId: data.vendorId || data.userId,
          recipientRole: Role.VENDOR,
          title: data.title || 'New Customer Order Received',
          body: data.message || `New order received: #${data.orderNumber || data.orderId}`,
          category: 'ORDER',
          data: { orderId: String(data.orderId || '') },
        });

      case QueueJobType.TRY_AND_BUY_HANDOVER:
      case QueueJobType.TRY_AND_BUY_DECISION:
      case QueueJobType.TRY_AND_BUY_EXPIRY_CHECK:
        return this.notificationsService.sendNotification({
          recipientUserId: data.userId || data.customerId || data.driverId,
          recipientRole: data.recipientRole || Role.DRIVER,
          title: data.title || 'Try & Buy Update',
          body: data.message || `Try & Buy status: ${name}`,
          category: 'DELIVERY',
          data: { orderId: String(data.orderId || ''), event: name },
        });

      default:
        this.logger.log(`[Worker] Handled custom notification event: ${name}`);
        return { handled: true };
    }
  }
}

