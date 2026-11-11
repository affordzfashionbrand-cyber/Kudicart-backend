import {
  Injectable,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  Optional,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService } from './state-machine.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { OutboxService } from '../queue/outbox.service';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';
import { OrderStatus } from '../../common/contracts/order-contracts';
import {
  computeCommissionBreakdown,
  DEFAULT_COMMISSION_RATE,
} from './order-pricing.util';

export interface OutboxDispatchInput {
  aggregateType?: string;
  eventType: string;
  payload: Record<string, any>;
}

export interface TransitionOrderInput {
  orderId: string;
  nextStatus: OrderStatus;
  actorRole: Role | 'SYSTEM' | string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  note?: string;
  expectedVersion?: number;
  auditAction?: string;
  extraOrderUpdate?: Record<string, any>;
  netKeptSubtotalForLedger?: number;
  extraOutboxEvents?: OutboxDispatchInput[];
}

@Injectable()
export class OrderTransitionService {
  private readonly logger = new Logger(OrderTransitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: StateMachineService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  async executeTransition(input: TransitionOrderInput) {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }

    const cleanLookup = input.orderId.trim().replace(/^#/, '');
    const now = new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: { OR: [{ id: input.orderId }, { id: cleanLookup }, { orderNumber: cleanLookup }] },
        include: {
          items: true,
          vendor: true,
          driver: true,
          tryAndBuySession: true,
        },
      });

      if (!existing) {
        throw new NotFoundException(`Order '${input.orderId}' not found`);
      }

      this.stateMachine.validateTransition(
        existing.status as OrderStatus,
        input.nextStatus,
        input.actorRole,
      );

      if (
        input.expectedVersion !== undefined &&
        existing.version !== input.expectedVersion
      ) {
        throw new ConflictException(
          `Order #${existing.orderNumber} was modified concurrently (expected v${input.expectedVersion}, found v${existing.version}).`,
        );
      }

      const updateData: Record<string, any> = {
        status: input.nextStatus as any,
        version: { increment: 1 },
        updatedAt: now,
        ...(input.extraOrderUpdate || {}),
      };

      if (input.nextStatus === 'DELIVERED') {
        updateData.deliveredAt = now;
        updateData.etaMinutes = 0;
      }

      if (input.nextStatus === 'CANCELLED') {
        updateData.cancelledAt = now;
        updateData.etaMinutes = 0;
        if (!updateData.cancellationReason && input.note) {
          updateData.cancellationReason = input.note;
        }
        if (existing.paymentStatus === 'COMPLETED') {
          updateData.paymentStatus = 'REFUND_PENDING';
        }
      }

      if (input.nextStatus === 'FAILED') {
        updateData.etaMinutes = 0;
        if (existing.paymentStatus === 'PENDING') {
          updateData.paymentStatus = 'FAILED';
        }
      }

      const casUpdate = await tx.order.updateMany({
        where: {
          id: existing.id,
          status: existing.status,
          version: existing.version,
        },
        data: updateData,
      });

      if (casUpdate.count === 0) {
        throw new ConflictException(
          `Concurrent state modification detected on Order #${existing.orderNumber}. Please retry.`,
        );
      }

      // Restore reserved stock when cancelling or failing an order
      if (input.nextStatus === 'CANCELLED' || input.nextStatus === 'FAILED') {
        for (const item of existing.items || []) {
          await tx.product.updateMany({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity || 1 } },
          });
        }
      }

      const transitionNote =
        input.note || `Order transitioned from ${existing.status} to ${input.nextStatus}`;

      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          status: input.nextStatus as any,
          note: transitionNote,
          actorId: input.actorId || null,
          actorRole: String(input.actorRole || 'SYSTEM'),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: input.actorId || null,
          userEmail: input.actorEmail || null,
          userRole: String(input.actorRole || 'SYSTEM'),
          action:
            input.auditAction || `ORDER_STATUS_${existing.status}_TO_${input.nextStatus}`,
          entityType: 'Order',
          entityId: existing.id,
          details: JSON.stringify({
            orderNumber: existing.orderNumber,
            previousStatus: existing.status,
            nextStatus: input.nextStatus,
            version: existing.version + 1,
            actorName: input.actorName || null,
            note: transitionNote,
          }),
        },
      });

      // Balanced double-entry vendor commission ledger posting on settlement
      if (input.nextStatus === 'DELIVERED' || input.nextStatus === 'RETURNED') {
        const netKeptSubtotal =
          input.netKeptSubtotalForLedger !== undefined
            ? input.netKeptSubtotalForLedger
            : Math.max(0, (existing.itemTotal || 0) - (existing.discountAmount || 0));

        if (netKeptSubtotal > 0) {
          const existingLedger = await tx.ledgerEntry.findFirst({
            where: { orderId: existing.id, entryType: 'ORDER_REVENUE' },
          });

          if (!existingLedger && existing.vendorId) {
            const commissionRate =
              existing.vendor?.commissionRate ?? DEFAULT_COMMISSION_RATE;
            const breakdown = computeCommissionBreakdown(netKeptSubtotal, commissionRate);

            await tx.ledgerEntry.createMany({
              data: [
                {
                  orderId: existing.id,
                  vendorId: existing.vendorId,
                  driverId: existing.driverProfileId || existing.driverId || null,
                  entryType: 'ORDER_REVENUE',
                  amount: netKeptSubtotal,
                  description: `Net merchandise revenue for Order #${existing.orderNumber}`,
                },
                {
                  orderId: existing.id,
                  vendorId: existing.vendorId,
                  driverId: existing.driverProfileId || existing.driverId || null,
                  entryType: 'COMMISSION_DEDUCTED',
                  amount: -breakdown.commissionAmount,
                  description: `Platform commission (${breakdown.commissionRate}%) on Order #${existing.orderNumber}`,
                },
                {
                  orderId: existing.id,
                  vendorId: existing.vendorId,
                  driverId: existing.driverProfileId || existing.driverId || null,
                  entryType: 'VENDOR_PAYOUT',
                  amount: breakdown.vendorPayout,
                  description: `Net vendor settlement payable for Order #${existing.orderNumber}`,
                },
              ],
            });
          }
        }
      }

      // Enqueue transactional outbox notifications and refunds
      const effectiveOrderForEvents = {
        ...existing,
        ...(input.extraOrderUpdate || {}),
        driverId: input.extraOrderUpdate?.driverId ?? existing.driverId,
        driverProfileId: input.extraOrderUpdate?.driverProfileId ?? existing.driverProfileId,
      };
      const outboxEvents: OutboxDispatchInput[] = [
        ...this.buildDefaultOutboxEvents(effectiveOrderForEvents, input.nextStatus, transitionNote),
        ...(input.extraOutboxEvents || []),
      ];

      if (
        input.nextStatus === 'CANCELLED' &&
        existing.paymentStatus === 'COMPLETED' &&
        existing.paymentMethod === 'RAZORPAY'
      ) {
        outboxEvents.push({
          aggregateType: 'PAYMENT',
          eventType: QueueJobType.REFUND_PROCESSING,
          payload: {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            paymentId: existing.razorpayPaymentId,
            refundAmount: existing.grandTotal,
            reason: transitionNote,
            isTryAndBuy: existing.isTryAndBuy,
          },
        });
      }

      for (const evt of outboxEvents) {
        await tx.outboxEvent.create({
          data: {
            aggregateType: evt.aggregateType || 'ORDER',
            aggregateId: existing.id,
            eventType: evt.eventType,
            payload: evt.payload,
            status: 'PENDING',
          },
        });
      }

      return tx.order.findUnique({
        where: { id: existing.id },
        include: {
          items: true,
          history: { orderBy: { createdAt: 'asc' } },
          address: true,
          vendor: true,
          driver: true,
          tryAndBuySession: true,
        },
      });
    });

    if (txResult) {
      this.trackingGateway?.broadcastStatusUpdate(txResult.id, input.nextStatus, {
        orderNumber: txResult.orderNumber,
        version: txResult.version,
        arrivedAt: txResult.arrivedAt?.toISOString?.() || null,
        deliveredAt: txResult.deliveredAt?.toISOString?.() || null,
      });

      this.outboxService?.dispatchPendingEvents().catch((err) => {
        this.logger.warn(`Post-transition outbox dispatch deferred: ${err?.message}`);
      });
    }

    return txResult;
  }

  private buildDefaultOutboxEvents(
    order: any,
    nextStatus: OrderStatus,
    note: string,
  ): OutboxDispatchInput[] {
    const events: OutboxDispatchInput[] = [];
    const basePayload = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      vendorId: order.vendorId,
      vendorUserId: order.vendor?.userId || null,
      driverId: order.driverId || null,
      status: nextStatus,
      note,
    };

    const customerEventType =
      nextStatus === 'DELIVERED'
        ? QueueJobType.CUSTOMER_ORDER_DELIVERED
        : QueueJobType.ORDER_STATUS_NOTIFICATION;

    events.push({
      eventType: customerEventType,
      payload: {
        ...basePayload,
        userId: order.customerId,
        title: `Order #${order.orderNumber} ${nextStatus.replace(/_/g, ' ')}`,
        message: note,
      },
    });

    if (nextStatus === 'CANCELLED') {
      if (order.vendor?.userId) {
        events.push({
          eventType: QueueJobType.VENDOR_ORDER_CANCELLED,
          payload: {
            ...basePayload,
            userId: order.vendor.userId,
            title: `Order #${order.orderNumber} Cancelled`,
            message: note,
          },
        });
      }
      if (order.driverId) {
        events.push({
          eventType: QueueJobType.ASSIGNMENT_CANCELLATION_NOTIFICATION,
          payload: {
            ...basePayload,
            userId: order.driverId,
            title: `Assignment Cancelled #${order.orderNumber}`,
            message: `Order #${order.orderNumber} was cancelled.`,
          },
        });
      }
    }

    if (nextStatus === 'ASSIGNED' && order.driverId) {
      events.push({
        eventType: QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION,
        payload: {
          ...basePayload,
          userId: order.driverId,
          title: `New Delivery Assigned #${order.orderNumber}`,
          message: `Pick up Order #${order.orderNumber} from ${order.vendor?.storeName || 'store'}.`,
        },
      });
    }

    if (nextStatus === 'READY_FOR_PICKUP') {
      events.push({
        eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
        payload: {
          ...basePayload,
          recipientRole: Role.ADMIN,
          title: `Ready for Rider Assignment #${order.orderNumber}`,
          message: `Order #${order.orderNumber} is packed and waiting for manual dispatch.`,
        },
      });
    }

    if (nextStatus === 'RETURNING' || nextStatus === 'RETURNED') {
      if (order.vendor?.userId) {
        events.push({
          eventType: QueueJobType.VENDOR_ORDER_NOTIFICATION,
          payload: {
            ...basePayload,
            userId: order.vendor.userId,
            title: `Try & Buy Return Update #${order.orderNumber}`,
            message: note,
          },
        });
      }
    }

    return events;
  }
}
