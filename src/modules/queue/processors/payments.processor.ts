import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { PaymentReconciliationService } from '../../payments/payment-reconciliation.service';
import {
  AFFORDZ_PAYMENTS_QUEUE,
  QueueJobType,
  getRedisConnectionOptions,
} from '../queue.constants';
import { QueueService } from '../queue.service';

@Injectable()
export class PaymentsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsProcessor.name);
  private worker?: Worker;

  constructor(
    private readonly paymentReconciliation: PaymentReconciliationService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit() {
    this.queueService.registerPaymentHandler((job) =>
      this.processPaymentJob(job),
    );

    const connection = getRedisConnectionOptions();
    if (!connection) {
      return;
    }

    this.worker = new Worker(
      AFFORDZ_PAYMENTS_QUEUE,
      async (job: Job) => this.processPaymentJob(job),
      { connection, concurrency: 3 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `[BullMQ] Payment job ${job?.name} (${job?.id}) failed: ${err?.message}`,
      );
    });

    this.logger.log(
      `PaymentsProcessor BullMQ worker attached to '${AFFORDZ_PAYMENTS_QUEUE}'`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.worker = undefined;
  }

  async processPaymentJob(job: { id?: string; name: string; data: any }) {
    const { name, data } = job;
    this.logger.log(
      `Processing payment job ${name} (id=${job.id || 'local'})`,
    );

    switch (name) {
      case QueueJobType.ORDER_EXPIRY_CHECK:
      case QueueJobType.PAYMENT_RECONCILIATION_CHECK:
      case QueueJobType.REFUND_PROCESSING: {
        const report = await this.paymentReconciliation.reconcile({
          pendingThresholdMinutes: 1,
          expiryThresholdMinutes: Number(data?.expiryThresholdMinutes ?? 15),
        });
        return {
          handled: true,
          jobType: name,
          checkoutGroupId: data?.checkoutGroupId || null,
          orderId: data?.orderId || null,
          report,
        };
      }

      default:
        this.logger.warn(`Unhandled payment job type: ${name}`);
        return { handled: false, jobType: name };
    }
  }
}
