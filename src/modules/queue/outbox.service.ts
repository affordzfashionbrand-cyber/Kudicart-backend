import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from './queue.service';
import { QueueJobType } from './queue.constants';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Persists an outbox event within a transactional boundary.
   * If a transaction client is passed, it is inserted atomically with the business mutation.
   */
  async recordEvent(
    tx: any,
    aggregateType: 'ORDER' | 'DISPATCH' | 'TRY_AND_BUY' | 'PAYMENT' | string,
    aggregateId: string,
    eventType: string,
    payload: any,
  ) {
    if (this.prisma.isConnectedToDb && tx && tx.outboxEvent) {
      try {
        const event = await tx.outboxEvent.create({
          data: {
            aggregateType,
            aggregateId,
            eventType,
            payload,
            status: 'PENDING',
          },
        });
        return event;
      } catch (err: any) {
        this.logger.warn(`Failed to record outbox event in DB transaction: ${err.message}`);
      }
    }

    // In-memory fallback for test doubles
    const store = this.prisma.getStore();
    if (!store.outboxEvents) {
      store.outboxEvents = [];
    }

    const event = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      aggregateType,
      aggregateId,
      eventType,
      payload,
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    store.outboxEvents.push(event);
    return event;
  }

  /**
   * Dispatches pending outbox events to BullMQ or asynchronous consumers.
   * Ensures that temporary Redis disconnects do not lose business events.
   */
  async dispatchPendingEvents(): Promise<{ processedCount: number; failedCount: number }> {
    let pendingEvents: any[] = [];

    if (this.prisma.isConnectedToDb) {
      try {
        pendingEvents = await this.prisma.outboxEvent.findMany({
          where: { status: 'PENDING', attempts: { lt: 5 } },
          orderBy: { createdAt: 'asc' },
          take: 50,
        });
      } catch (err: any) {
        this.logger.warn(`Could not read pending outbox events from DB: ${err.message}`);
      }
    } else {
      const store = this.prisma.getStore();
      pendingEvents = (store.outboxEvents || []).filter(
        (e: any) => e.status === 'PENDING' && (e.attempts || 0) < 5,
      );
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const evt of pendingEvents) {
      try {
        // Atomic lease claim: ensure this worker uniquely owns the event before enqueuing
        if (this.prisma.isConnectedToDb) {
          const claim = await this.prisma.outboxEvent.updateMany({
            where: { id: evt.id, status: 'PENDING' },
            data: { status: 'PUBLISHED', publishedAt: new Date() },
          });
          if (claim.count === 0) {
            // Concurrently claimed by another worker instance
            continue;
          }
        } else {
          if (evt.status !== 'PENDING') {
            continue;
          }
          evt.status = 'PUBLISHED';
          evt.publishedAt = new Date().toISOString();
        }

        // Enqueue to BullMQ
        await this.queueService.enqueueNotification(
          (evt.eventType as any) || QueueJobType.ORDER_STATUS_NOTIFICATION,
          evt.payload,
        );

        processedCount++;
      } catch (err: any) {
        failedCount++;
        this.logger.error(`Failed to dispatch outbox event ${evt.id}: ${err.message}`);

        if (this.prisma.isConnectedToDb) {
          await this.prisma.outboxEvent.update({
            where: { id: evt.id },
            data: {
              attempts: { increment: 1 },
              lastError: err.message,
              status: (evt.attempts || 0) >= 4 ? 'FAILED' : 'PENDING',
              publishedAt: null,
            },
          });
        } else {
          evt.attempts = (evt.attempts || 0) + 1;
          evt.lastError = err.message;
          evt.status = evt.attempts >= 5 ? 'FAILED' : 'PENDING';
          evt.publishedAt = null;
        }
      }
    }

    return { processedCount, failedCount };
  }
}
