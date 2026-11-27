import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  Optional,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StateMachineService } from './state-machine.service';
import {
  AutoAssignResult,
  DeliveryAssignmentService,
} from './delivery-assignment.service';
import { TrackingRealtimeGateway } from './tracking-realtime.gateway';
import { OutboxService } from '../queue/outbox.service';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';
import {
  OrderStatus,
  getCustomerOrderStatusLabel,
} from '../../common/contracts/order-contracts';
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
  triggerAutoAssignment?: boolean;
}

@Injectable()
export class OrderTransitionService {
  private readonly logger = new Logger(OrderTransitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: StateMachineService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional() private readonly deliveryAssignment?: DeliveryAssignmentService,
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
          items: { include: { product: { include: { darkStoreHub: true } } } },
          vendor: { include: { user: true } },
          driver: true,
          driverProfile: true,
          tryAndBuySession: true,
          dispatchAssignment: true,
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

      // Strict isolation between Standard and Try & Buy order lifecycles
      if (input.nextStatus === 'TRY_AND_BUY' && !existing.isTryAndBuy) {
        throw new BadRequestException(
          `Standard Order #${existing.orderNumber} cannot enter TRY_AND_BUY status.`,
        );
      }
      if (
        existing.isTryAndBuy &&
        existing.status === 'OUT_FOR_DELIVERY' &&
        input.nextStatus === 'DELIVERED'
      ) {
        throw new BadRequestException(
          `Try & Buy Order #${existing.orderNumber} cannot be marked DELIVERED directly before customer Try & Buy verification.`,
        );
      }
      if (
        existing.isTryAndBuy &&
        input.nextStatus === 'DELIVERED' &&
        !existing.tryAndBuySession?.customerSelectionAt &&
        !(existing.items || []).some(
          (i: any) => i.tryAndBuyDecision === 'KEEP' || i.tryAndBuyDecision === 'RETURN',
        )
      ) {
        throw new BadRequestException(
          `Try & Buy Order #${existing.orderNumber} requires an explicit customer Keep/Return decision before marking DELIVERED.`,
        );
      }

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

      if (input.nextStatus === 'ACCEPTED') {
        updateData.acceptedAt = existing.acceptedAt || now;
      }

      if (input.nextStatus === 'PACKING' || input.nextStatus === 'PREPARING') {
        updateData.packingStartedAt = existing.packingStartedAt || now;
      }

      if (input.nextStatus === 'READY_FOR_PICKUP') {
        updateData.readyForPickupAt = existing.readyForPickupAt || now;
      }

      if (input.nextStatus === 'OUT_FOR_DELIVERY') {
        updateData.pickedUpAt = existing.pickedUpAt || now;
        if (existing.driverProfileId && !updateData.deliveryAssignmentStatus) {
          updateData.deliveryAssignmentStatus = 'ACCEPTED_BY_DELIVERY_PARTNER';
        }
      }

      if (input.nextStatus === 'TRY_AND_BUY') {
        updateData.arrivedAt = existing.arrivedAt || now;
        updateData.tryAndBuyStartedAt = existing.tryAndBuyStartedAt || now;
        updateData.etaMinutes = 0;
      }

      if (input.nextStatus === 'DELIVERED') {
        updateData.deliveredAt = now;
        updateData.etaMinutes = 0;
        updateData.deliveryAssignmentStatus = 'COMPLETED';
      }

      if (input.nextStatus === 'RETURNED') {
        updateData.returnedAt = now;
        updateData.etaMinutes = 0;
        updateData.deliveryAssignmentStatus = 'COMPLETED';
      }

      if (input.nextStatus === 'CANCELLED') {
        updateData.cancelledAt = now;
        updateData.etaMinutes = 0;
        updateData.deliveryAssignmentStatus = existing.driverProfileId ? 'FAILED' : 'NOT_ASSIGNED';
        if (!updateData.cancellationReason && input.note) {
          updateData.cancellationReason = input.note;
        }
        if (existing.paymentStatus === 'COMPLETED') {
          updateData.paymentStatus = 'REFUND_PENDING';
        }
      }

      if (input.nextStatus === 'FAILED') {
        updateData.etaMinutes = 0;
        updateData.deliveryAssignmentStatus = existing.driverProfileId ? 'FAILED' : 'NOT_ASSIGNED';
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

      // Sync DispatchAssignment terminal/active state cleanly inside same transaction
      if (input.nextStatus === 'DELIVERED' || input.nextStatus === 'RETURNED') {
        await tx.dispatchAssignment.updateMany({
          where: { orderId: existing.id },
          data: {
            status: 'COMPLETED',
            assignmentStatus: 'COMPLETED',
            completedAt: now,
          },
        });
      } else if (input.nextStatus === 'CANCELLED' || input.nextStatus === 'FAILED') {
        await tx.dispatchAssignment.updateMany({
          where: { orderId: existing.id },
          data: {
            status: 'CANCELLED',
            assignmentStatus: 'FAILED',
            failureReason: updateData.cancellationReason || input.note || `Order ${input.nextStatus}`,
          },
        });
      } else if (
        input.nextStatus === 'OUT_FOR_DELIVERY' &&
        existing.driverProfileId
      ) {
        await tx.dispatchAssignment.upsert({
          where: { orderId: existing.id },
          update: {
            status: 'ACCEPTED',
            assignmentStatus: 'ACCEPTED_BY_DELIVERY_PARTNER',
            acceptedAt: existing.dispatchAssignment?.acceptedAt || now,
            respondedAt: existing.dispatchAssignment?.respondedAt || now,
          },
          create: {
            orderId: existing.id,
            driverProfileId: existing.driverProfileId,
            status: 'ACCEPTED',
            assignmentStatus: 'ACCEPTED_BY_DELIVERY_PARTNER',
            assignmentSource: 'MANUAL',
            offeredAt: now,
            respondedAt: now,
            acceptedAt: now,
            attempts: 1,
          },
        });
      }

      // Trigger automatic delivery partner assignment when accepting an order inside the same atomic transaction
      let autoAssignResult: AutoAssignResult | null = null;
      if (input.triggerAutoAssignment && this.deliveryAssignment) {
        autoAssignResult = await this.deliveryAssignment.assignOrderInTransaction(
          tx,
          {
            ...existing,
            status: input.nextStatus,
            version: existing.version + 1,
          },
          {
            actorId: input.actorId,
            actorRole: String(input.actorRole || 'SYSTEM'),
            actorName: input.actorName,
          },
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

        // Release per-user coupon usage only if no active non-cancelled/non-failed orders remain in checkoutGroup
        if (existing.checkoutGroupId) {
          const remainingActiveOrders = await tx.order.count({
            where: {
              checkoutGroupId: existing.checkoutGroupId,
              status: { notIn: ['CANCELLED', 'FAILED'] },
            },
          });
          if (remainingActiveOrders === 0) {
            const releasedUsages = await tx.couponUsage.findMany({
              where: { checkoutGroupId: existing.checkoutGroupId },
            });
            if (releasedUsages.length > 0) {
              await tx.couponUsage.deleteMany({
                where: { checkoutGroupId: existing.checkoutGroupId },
              });
              for (const usage of releasedUsages) {
                await tx.coupon.updateMany({
                  where: { id: usage.couponId, usedCount: { gt: 0 } },
                  data: { usedCount: { decrement: 1 } },
                });
              }
            }
          }
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
            let totalCommission = 0;
            let hasItemCommissions = false;

            const keptItemIds: string[] | null =
              Array.isArray((existing as any).tryAndBuySession?.keptItemIds)
                ? (existing as any).tryAndBuySession.keptItemIds
                : null;

            if (Array.isArray(existing.items) && existing.items.length > 0) {
              for (const it of existing.items) {
                // If Try & Buy kept items are specified, ignore returned items
                if (keptItemIds && keptItemIds.length > 0 && !keptItemIds.includes(it.id)) {
                  continue;
                }
                if ((it as any).commissionAmount != null) {
                  totalCommission += Number((it as any).commissionAmount);
                  hasItemCommissions = true;
                }
              }
            }

            let commissionAmount = 0;
            let vendorPayout = 0;
            let displayRate = 0;

            if (hasItemCommissions && totalCommission > 0) {
              // If partial subtotal is settled (e.g. returns) and keptItemIds was not explicit, prorate proportionally
              const totalItemsSubtotal = (existing.items || []).reduce(
                (sum, it) => sum + Number(it.price || 0) * Number(it.quantity || 1),
                0,
              );
              if (!keptItemIds && totalItemsSubtotal > 0 && netKeptSubtotal < totalItemsSubtotal) {
                totalCommission = (totalCommission / totalItemsSubtotal) * netKeptSubtotal;
              }

              commissionAmount = Math.round(totalCommission * 100) / 100;
              vendorPayout = Math.max(0, Math.round((netKeptSubtotal - commissionAmount) * 100) / 100);
              displayRate = netKeptSubtotal > 0 ? Math.round((commissionAmount / netKeptSubtotal) * 1000) / 10 : 0;
            } else {
              const commissionRate = existing.vendor?.commissionRate ?? DEFAULT_COMMISSION_RATE;
              const breakdown = computeCommissionBreakdown(netKeptSubtotal, commissionRate);
              commissionAmount = breakdown.commissionAmount;
              vendorPayout = breakdown.vendorPayout;
              displayRate = breakdown.commissionRate;
            }

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
                  amount: -commissionAmount,
                  description: `Platform category-wise commission (~${displayRate}%) on Order #${existing.orderNumber}`,
                },
                {
                  orderId: existing.id,
                  vendorId: existing.vendorId,
                  driverId: existing.driverProfileId || existing.driverId || null,
                  entryType: 'VENDOR_PAYOUT',
                  amount: vendorPayout,
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

      return {
        autoAssignResult,
        order: await tx.order.findUnique({
          where: { id: existing.id },
          include: {
            items: true,
            history: { orderBy: { createdAt: 'asc' } },
            address: true,
            vendor: true,
            driver: true,
            driverProfile: true,
            tryAndBuySession: true,
            dispatchAssignment: true,
          },
        }),
      };
    });

    if (txResult?.order) {
      const ord = txResult.order;
      const semanticEventType =
        input.nextStatus === 'ACCEPTED'
          ? 'ORDER_ACCEPTED'
          : input.nextStatus === 'READY_FOR_PICKUP'
            ? 'ORDER_READY_FOR_PICKUP'
            : input.nextStatus === 'OUT_FOR_DELIVERY'
              ? 'ORDER_OUT_FOR_DELIVERY'
              : input.nextStatus === 'TRY_AND_BUY'
                ? 'TRY_AND_BUY_STARTED'
                : input.nextStatus === 'DELIVERED'
                  ? 'ORDER_DELIVERED'
                  : input.nextStatus === 'RETURNED'
                    ? 'ORDER_RETURNED'
                    : 'ORDER_STATUS_UPDATE';

      this.trackingGateway?.broadcastStatusUpdate(ord.id, input.nextStatus, {
        eventType: semanticEventType,
        orderNumber: ord.orderNumber,
        orderType: ord.orderType,
        deliveryAssignmentStatus: ord.deliveryAssignmentStatus,
        vendorId: ord.vendorId ?? null,
        driverId: ord.driverId ?? null,
        driverProfileId: ord.driverProfileId ?? null,
        version: ord.version,
        pickedUpAt: ord.pickedUpAt?.toISOString?.() || null,
        tryAndBuyStartedAt: ord.tryAndBuyStartedAt?.toISOString?.() || null,
        arrivedAt: ord.arrivedAt?.toISOString?.() || null,
        deliveredAt: ord.deliveredAt?.toISOString?.() || null,
        returnedAt: ord.returnedAt?.toISOString?.() || null,
      });

      if (txResult.autoAssignResult) {
        this.trackingGateway?.broadcastStatusUpdate(ord.id, ord.status, {
          eventType: txResult.autoAssignResult.assigned
            ? 'DELIVERY_ASSIGNMENT_CREATED'
            : 'DELIVERY_ASSIGNMENT_FAILED',
          orderNumber: ord.orderNumber,
          orderType: ord.orderType,
          deliveryAssignmentStatus: ord.deliveryAssignmentStatus,
          vendorId: ord.vendorId ?? null,
          driverId: ord.driverId ?? null,
          driverProfileId: ord.driverProfileId ?? null,
        });
      }

      this.outboxService?.dispatchPendingEvents().catch((err) => {
        this.logger.warn(`Post-transition outbox dispatch deferred: ${err?.message}`);
      });
    }

    return txResult.order;
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
        : nextStatus === 'TRY_AND_BUY'
          ? QueueJobType.TRY_AND_BUY_STARTED
          : nextStatus === 'RETURNED'
            ? QueueJobType.ORDER_RETURNED
            : QueueJobType.ORDER_STATUS_NOTIFICATION;

    const customerFriendlyTitle =
      nextStatus === 'DELIVERED'
        ? `Order #${order.orderNumber} Delivered`
        : nextStatus === 'OUT_FOR_DELIVERY'
          ? `Order #${order.orderNumber} Out for Delivery`
          : nextStatus === 'TRY_AND_BUY'
            ? `Try & Buy Started #${order.orderNumber}`
            : nextStatus === 'RETURNED' || nextStatus === 'RETURNING'
              ? `Order Return Update #${order.orderNumber}`
              : `Order #${order.orderNumber} Update`;

    const customerMessage = getCustomerOrderStatusLabel(nextStatus, order.isTryAndBuy);

    events.push({
      eventType: customerEventType,
      payload: {
        ...basePayload,
        userId: order.customerId,
        title: customerFriendlyTitle,
        message: `${customerMessage} • #${order.orderNumber}`,
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
      if (order.driverId) {
        events.push({
          eventType: QueueJobType.DRIVER_ASSIGNMENT_NOTIFICATION,
          payload: {
            ...basePayload,
            userId: order.driverId,
            driverUserId: order.driverId,
            title: `Ready for Pickup #${order.orderNumber}`,
            message: `Order #${order.orderNumber} is packed and ready for collection.`,
          },
        });
      } else {
        events.push({
          eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
          payload: {
            ...basePayload,
            recipientRole: Role.ADMIN,
            title: `Ready for Pickup (Needs Rider) #${order.orderNumber}`,
            message: `Order #${order.orderNumber} is packed and awaiting partner assignment.`,
          },
        });
      }
    }

    if (nextStatus === 'OUT_FOR_DELIVERY' && order.vendor?.userId) {
      events.push({
        eventType: QueueJobType.VENDOR_ORDER_NOTIFICATION,
        payload: {
          ...basePayload,
          userId: order.vendor.userId,
          title: `Order Picked Up #${order.orderNumber}`,
          message: `Delivery partner confirmed pickup for #${order.orderNumber}.`,
        },
      });
    }

    if (nextStatus === 'RETURNING' || nextStatus === 'RETURNED' || nextStatus === 'DELIVERED') {
      if (order.vendor?.userId) {
        events.push({
          eventType: QueueJobType.VENDOR_ORDER_NOTIFICATION,
          payload: {
            ...basePayload,
            userId: order.vendor.userId,
            title:
              nextStatus === 'DELIVERED'
                ? `Order Delivered #${order.orderNumber}`
                : `Try & Buy Return Update #${order.orderNumber}`,
            message: note,
          },
        });
      }
    }

    return events;
  }
}
