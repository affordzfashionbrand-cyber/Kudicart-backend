import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from './queue.service';
import { QueueJobType } from './queue.constants';
import { TrackingRealtimeGateway } from '../orders/tracking-realtime.gateway';

interface ClaimedOutboxRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: any;
  attempts: number;
  createdAt: Date;
}

const PAYMENT_JOB_TYPES = new Set<string>([
  QueueJobType.REFUND_PROCESSING,
  QueueJobType.PAYMENT_RECONCILIATION_CHECK,
  QueueJobType.ORDER_EXPIRY_CHECK,
]);

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
  ) {}

  async recordEvent(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: any,
  ) {
    if (!this.prisma.isConnectedToDb) {
      throw new Error('Database connection required to record OutboxEvent');
    }

    return this.prisma.outboxEvent.create({
      data: {
        aggregateType,
        aggregateId,
        eventType,
        payload,
        status: 'PENDING',
      },
    });
  }

  private broadcastRealtimeIfApplicable(eventType: string, payload: any) {
    const orderId = payload?.orderId;
    if (!orderId || !this.trackingGateway) return;

    try {
      if (eventType === 'ORDER_ARRIVED') {
        this.trackingGateway.broadcastStatusUpdate(
          orderId,
          payload.status || 'OUT_FOR_DELIVERY',
          { ...payload, event: 'ORDER_ARRIVED' },
        );
      } else if (eventType === 'TRY_AND_BUY_UPDATED') {
        this.trackingGateway.broadcastStatusUpdate(
          orderId,
          payload.status || 'OUT_FOR_DELIVERY',
          { ...payload, event: 'TRY_AND_BUY_UPDATED' },
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Realtime gateway broadcast skipped for ${eventType}: ${err?.message}`,
      );
    }
  }

  async dispatchPendingEvents(batchSize = 25) {
    if (!this.prisma.isConnectedToDb) {
      return {
        processedCount: 0,
        publishedCount: 0,
        failedCount: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const limit = Math.min(Math.max(Number(batchSize || 25), 1), 100);
    let publishedCount = 0;
    let failedCount = 0;
    let processedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      const pending = await tx.$queryRaw<ClaimedOutboxRow[]>`
        SELECT id, "aggregateType", "aggregateId", "eventType", payload, attempts, "createdAt"
        FROM "OutboxEvent"
        WHERE status = 'PENDING'::"OutboxStatus"
          AND attempts < 5
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      processedCount = pending.length;

      for (const evt of pending) {
        const nextAttempts = (evt.attempts || 0) + 1;
        try {
          const payload = evt.payload || {};
          this.broadcastRealtimeIfApplicable(evt.eventType, payload);

          if (PAYMENT_JOB_TYPES.has(evt.eventType)) {
            await this.queueService.enqueuePaymentJob(evt.eventType, payload);
          } else if (evt.eventType !== 'TRY_AND_BUY_UPDATED') {
            await this.queueService.enqueueNotification(evt.eventType, payload);
          }

          await tx.outboxEvent.update({
            where: { id: evt.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              attempts: nextAttempts,
              lastError: null,
            },
          });
          publishedCount++;
        } catch (err: any) {
          failedCount++;
          await tx.outboxEvent.update({
            where: { id: evt.id },
            data: {
              attempts: nextAttempts,
              status: nextAttempts >= 5 ? 'FAILED' : 'PENDING',
              lastError: err?.message || 'Outbox dispatch failure',
            },
          });
          this.logger.error(
            `Outbox event ${evt.id} (${evt.eventType}) attempt ${nextAttempts} failed: ${err?.message}`,
          );
        }
      }
    });

    return {
      processedCount,
      publishedCount,
      failedCount,
      timestamp: new Date().toISOString(),
    };
  }
}
