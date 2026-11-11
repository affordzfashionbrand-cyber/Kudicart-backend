import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  AFFORDZ_NOTIFICATIONS_QUEUE,
  AFFORDZ_PAYMENTS_QUEUE,
  QueueJobType,
  getRedisConnectionOptions,
} from './queue.constants';

export type InProcessJobHandler = (job: {
  id?: string;
  name: string;
  data: any;
}) => Promise<any>;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private notificationsQueue?: Queue;
  private paymentsQueue?: Queue;
  private isRedisConnected = false;
  private isDestroyed = false;

  private notificationHandler?: InProcessJobHandler;
  private paymentHandler?: InProcessJobHandler;
  private readonly pendingTimers = new Set<NodeJS.Timeout>();

  registerNotificationHandler(handler: InProcessJobHandler) {
    this.notificationHandler = handler;
  }

  registerPaymentHandler(handler: InProcessJobHandler) {
    this.paymentHandler = handler;
  }

  async onModuleInit() {
    this.isDestroyed = false;
    const connection = getRedisConnectionOptions();
    if (!connection) {
      this.logger.warn(
        'REDIS_HOST/REDIS_URL not configured. Using in-process async queue fallback.',
      );
      return;
    }

    try {
      this.notificationsQueue = new Queue(AFFORDZ_NOTIFICATIONS_QUEUE, {
        connection,
      });
      this.paymentsQueue = new Queue(AFFORDZ_PAYMENTS_QUEUE, {
        connection,
      });
      this.isRedisConnected = true;
      this.logger.log(
        `BullMQ queues initialized (${AFFORDZ_NOTIFICATIONS_QUEUE}, ${AFFORDZ_PAYMENTS_QUEUE})`,
      );
    } catch (err: any) {
      this.isRedisConnected = false;
      this.logger.warn(
        `Failed to initialize BullMQ queues (${err?.message}); falling back to in-process dispatch.`,
      );
    }
  }

  async onModuleDestroy() {
    this.isDestroyed = true;
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

    await Promise.allSettled([
      this.notificationsQueue?.close(),
      this.paymentsQueue?.close(),
    ]);
    this.notificationsQueue = undefined;
    this.paymentsQueue = undefined;
    this.isRedisConnected = false;
  }

  getQueueStatus() {
    const activeQueues = [AFFORDZ_NOTIFICATIONS_QUEUE, AFFORDZ_PAYMENTS_QUEUE];
    return {
      redisConfigured: Boolean(getRedisConnectionOptions()),
      isRedisConnected: this.isRedisConnected,
      activeQueues,
    };
  }

  async enqueueNotification(jobType: QueueJobType | string, payload: any) {
    if (this.notificationsQueue && this.isRedisConnected) {
      const job = await this.notificationsQueue.add(String(jobType), payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
      return {
        id: job.id,
        type: String(jobType),
        status: 'queued-bullmq',
        queue: AFFORDZ_NOTIFICATIONS_QUEUE,
      };
    }

    const fallbackId = `local-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.notificationHandler) {
      try {
        await this.notificationHandler({
          id: fallbackId,
          name: String(jobType),
          data: payload,
        });
      } catch (err: any) {
        this.logger.warn(
          `In-process notification handler error for ${jobType}: ${err?.message}`,
        );
      }
    }

    return {
      id: fallbackId,
      type: String(jobType),
      status: 'queued-in-process',
      queue: AFFORDZ_NOTIFICATIONS_QUEUE,
    };
  }

  async enqueuePaymentJob(
    jobType: QueueJobType | string,
    payload: any,
    options?: { delayMs?: number; jobId?: string },
  ) {
    const delay = Math.max(0, Number(options?.delayMs || 0));

    if (this.paymentsQueue && this.isRedisConnected) {
      const job = await this.paymentsQueue.add(String(jobType), payload, {
        delay: delay || undefined,
        jobId: options?.jobId || undefined,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
      return {
        id: job.id,
        type: String(jobType),
        status: 'queued-bullmq',
        queue: AFFORDZ_PAYMENTS_QUEUE,
        scheduledDelayMs: delay,
      };
    }

    const fallbackId =
      options?.jobId ||
      `local-pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (this.paymentHandler && !this.isDestroyed) {
      if (delay > 0) {
        const timer = setTimeout(() => {
          this.pendingTimers.delete(timer);
          if (this.isDestroyed || !this.paymentHandler) return;
          void this.paymentHandler({
            id: fallbackId,
            name: String(jobType),
            data: payload,
          }).catch((err: any) => {
            this.logger.warn(
              `In-process delayed payment job ${jobType} failed: ${err?.message}`,
            );
          });
        }, delay);
        timer.unref();
        this.pendingTimers.add(timer);
      } else {
        try {
          await this.paymentHandler({
            id: fallbackId,
            name: String(jobType),
            data: payload,
          });
        } catch (err: any) {
          this.logger.warn(
            `In-process payment handler error for ${jobType}: ${err?.message}`,
          );
        }
      }
    }

    return {
      id: fallbackId,
      type: String(jobType),
      status: 'queued-in-process',
      queue: AFFORDZ_PAYMENTS_QUEUE,
      scheduledDelayMs: delay,
    };
  }

  async enqueuePaymentReconciliation(orderId: string, delayMs = 120000) {
    return this.enqueuePaymentJob(
      QueueJobType.PAYMENT_RECONCILIATION_CHECK,
      { orderId },
      { delayMs },
    );
  }

  async enqueueOrderExpiryCheck(checkoutGroupId: string, delayMs = 15 * 60 * 1000) {
    return this.enqueuePaymentJob(
      QueueJobType.ORDER_EXPIRY_CHECK,
      { checkoutGroupId },
      {
        delayMs,
        jobId: `order-expiry:${checkoutGroupId}`,
      },
    );
  }
}
