import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { KUDICART_PAYMENTS_QUEUE, QueueJobType } from '../queue.constants';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class PaymentsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsProcessor.name);
  private worker: Worker | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
          KUDICART_PAYMENTS_QUEUE,
          async (job: Job) => {
            return this.processJob(job);
          },
          {
            connection,
            concurrency: Number(process.env.WORKER_CONCURRENCY) || 3,
          },
        );

        this.worker.on('completed', (job: Job) => {
          this.logger.log(`[Worker:Payments] Job ${job.id} (${job.name}) completed successfully`);
        });

        this.worker.on('failed', (job: Job | undefined, err: Error) => {
          this.logger.error(
            `[Worker:Payments] Job ${job?.id} (${job?.name}) failed: ${err.message}. Attempts: ${job?.attemptsMade}/${job?.opts.attempts || 5}`,
            err.stack,
          );
        });

        this.logger.log(`BullMQ Worker registered for queue: ${KUDICART_PAYMENTS_QUEUE}`);
      } catch (err: any) {
        this.logger.warn(`Could not start BullMQ Payments Worker: ${err.message}`);
      }
    } else {
      this.logger.log('Payments BullMQ Worker standing by (REDIS_HOST not configured)');
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log(`Closed Payments Worker for ${KUDICART_PAYMENTS_QUEUE}`);
    }
  }

  /**
   * Processes payments reconciliation and retry events.
   */
  async processJob(job: Job) {
    const { name, data } = job;
    this.logger.log(`[Worker:Payments] Processing payment job ${name} for order: ${data?.orderId}`);

    if (name === QueueJobType.PAYMENT_RECONCILIATION_CHECK) {
      const orderId = data?.orderId;
      if (!orderId) return { reconciled: false, reason: 'NO_ORDER_ID' };

      if (this.prisma.isConnectedToDb) {
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
        });

        if (!order) return { reconciled: false, reason: 'ORDER_NOT_FOUND' };

        // Verify if payment is still pending after timeout
        if (order.paymentStatus === 'PENDING') {
          this.logger.warn(
            `[PaymentRecon] Order ${orderId} remains in PENDING payment status after timeout window`,
          );
        }
        return { reconciled: true, orderId, paymentStatus: order.paymentStatus };
      }

      return { reconciled: true, orderId, simulated: true };
    }

    if (name === QueueJobType.REFUND_PROCESSING || name === 'REFUND_PROCESSING') {
      const orderId = data?.orderId;
      const isTryAndBuy = data?.isTryAndBuy ?? true;

      // 1. Business policy safeguard: automated Try & Buy refunds remain disabled by default
      // until formal approval of policies regarding return charges, damaged goods, and partial refunds.
      const autoRefundEnabled = process.env.ENABLE_AUTO_REFUND === 'true';

      if (!autoRefundEnabled) {
        this.logger.warn(
          `[PaymentsProcessor] Automated refund processing withheld for order ${orderId}. Policy requires manual admin supervisor approval.`,
        );

        if (this.prisma.isConnectedToDb && orderId) {
          try {
            await this.prisma.order.update({
              where: { id: orderId },
              data: {
                paymentStatus: 'REFUND_PENDING_REVIEW' as any,
              },
            });
          } catch (dbErr: any) {
            this.logger.warn(`Could not flag order ${orderId} as REFUND_PENDING_REVIEW: ${dbErr?.message}`);
          }
        }

        return {
          processed: false,
          status: 'PENDING_REVIEW',
          reason: 'AUTOMATED_REFUND_POLICY_UNAPPROVED',
          message: 'Case placed into Admin-visible pending-review state. Manual approval required.',
        };
      }

      // 2. If explicitly enabled via config, verify payment idempotency and external provider response
      if (this.prisma.isConnectedToDb && orderId) {
        const order = await this.prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return { processed: false, reason: 'ORDER_NOT_FOUND' };
        if (order.paymentStatus === 'REFUNDED') {
          return { processed: true, idempotency: true, reason: 'ALREADY_REFUNDED' };
        }
      }

      // Never simulate success; if provider credentials missing, fail safely
      return {
        processed: false,
        status: 'FAILED',
        reason: 'PAYMENT_GATEWAY_CREDENTIALS_MISSING',
      };
    }

    return { handled: true };
  }
}
