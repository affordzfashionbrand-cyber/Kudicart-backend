import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderTransitionService } from '../orders/order-transition.service';
import { TrackingRealtimeGateway } from '../orders/tracking-realtime.gateway';
import { QueueJobType } from '../queue/queue.constants';
import { Role } from '../../common/enums/role.enum';
import { computeTryAndBuyFinancials } from '../orders/order-pricing.util';
import { verifyOrderOtpHash } from '../orders/order-otp.util';
import {
  TryAndBuyHandoverDto,
  TryAndBuySelectionsDto,
  TryAndBuyReturnCollectionDto,
  TryAndBuySettlePaymentDto,
  TryAndBuyReconciliationDto,
} from './dto/try-and-buy.dto';
import { formatOrderPacket } from './driver-order.formatter';

const TNB_ORDER_INCLUDE = {
  items: { include: { product: { include: { darkStoreHub: true } } } },
  history: { orderBy: { createdAt: 'asc' as const } },
  customer: { select: { id: true, name: true, phone: true } },
  vendor: { include: { user: { select: { id: true, name: true, phone: true } } } },
  address: true,
  tryAndBuySession: true,
};

@Injectable()
export class DriverTryAndBuyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderTransition: OrderTransitionService,
    @Optional() private readonly trackingGateway?: TrackingRealtimeGateway,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveOrderAndDriver(driverIdOrUserId: string | undefined, orderId: string) {
    this.ensureDbConnected();
    if (!driverIdOrUserId) {
      throw new BadRequestException('Authenticated driver context is required');
    }

    const driver = await this.prisma.driverProfile.findFirst({
      where: { OR: [{ id: driverIdOrUserId }, { userId: driverIdOrUserId }] },
    });
    if (!driver) {
      throw new NotFoundException('Driver profile not found');
    }

    const cleanId = orderId.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
      include: TNB_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isOwner =
      order.driverProfileId === driver.id ||
      order.driverId === driver.userId ||
      order.driverId === driver.id;
    if (!isOwner) {
      throw new ForbiddenException('Order is not assigned to your driver account');
    }

    if (!order.isTryAndBuy) {
      throw new BadRequestException('Order is not configured as Try & Buy');
    }

    return { driver, order };
  }

  async confirmHandover(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuyHandoverDto,
  ) {
    const { driver, order } = await this.resolveOrderAndDriver(driverId, orderId);

    if (order.status !== 'OUT_FOR_DELIVERY') {
      throw new BadRequestException(
        `Doorstep Try & Buy handover requires order status OUT_FOR_DELIVERY (current: ${order.status})`,
      );
    }

    const otpValid = verifyOrderOtpHash(order.id, dto.otp, order.deliveryOtpHash);
    if (!otpValid) {
      throw new BadRequestException('Invalid customer Try & Buy verification OTP');
    }

    const now = new Date();
    const trialEnds = new Date(now.getTime() + 10 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      if (!order.arrivedAt) {
        await tx.order.update({
          where: { id: order.id },
          data: { arrivedAt: now },
        });
      }

      await tx.tryAndBuySession.upsert({
        where: { orderId: order.id },
        update: {
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: 'TRIAL_IN_PROGRESS',
          handoverConfirmedAt: now,
          trialStartedAt: now,
          trialEndsAt: trialEnds,
          handoverImages: dto.handoverImages || [],
        },
        create: {
          orderId: order.id,
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: 'TRIAL_IN_PROGRESS',
          trialDurationMinutes: 10,
          handoverConfirmedAt: now,
          trialStartedAt: now,
          trialEndsAt: trialEnds,
          handoverImages: dto.handoverImages || [],
        },
      });

      await tx.auditLog.create({
        data: {
          userId: driver.userId,
          userRole: Role.DRIVER,
          action: 'TRY_AND_BUY_HANDOVER_CONFIRMED',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({
            driverProfileId: driver.id,
            handoverImagesCount: (dto.handoverImages || []).length,
            trialEndsAt: trialEnds.toISOString(),
          }),
        },
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'ORDER',
          aggregateId: order.id,
          eventType: QueueJobType.ORDER_STATUS_NOTIFICATION,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.customerId,
            title: `Trial Started #${order.orderNumber}`,
            message: 'Your 10-minute doorstep trial has started. Select KEEP or RETURN in your Affordz app.',
          },
        },
      });
    });

    this.trackingGateway?.broadcastStatusUpdate(order.id, order.status, {
      eventType: 'TRY_AND_BUY_UPDATED',
      stage: 'TRIAL_IN_PROGRESS',
      trialEndsAt: trialEnds.toISOString(),
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: TNB_ORDER_INCLUDE,
    });

    return {
      success: true,
      message: 'Handover OTP verified. 10-minute customer trial timer started.',
      trialDurationMinutes: 10,
      trialStartedAt: now.toISOString(),
      trialEndsAt: trialEnds.toISOString(),
      order: formatOrderPacket(refreshed, undefined, true),
    };
  }

  async recordSelections(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuySelectionsDto,
  ) {
    const { driver, order } = await this.resolveOrderAndDriver(driverId, orderId);

    if (order.status !== 'OUT_FOR_DELIVERY') {
      throw new BadRequestException(
        `Try & Buy selections require order status OUT_FOR_DELIVERY (current: ${order.status})`,
      );
    }

    if (!order.items || order.items.length === 0) {
      throw new BadRequestException('Order has no line items to evaluate');
    }

    const completeSelections: Record<string, 'KEEP' | 'RETURN'> = {};
    for (const item of order.items) {
      const val = dto.selections?.[item.id];
      if (val !== 'KEEP' && val !== 'RETURN') {
        throw new BadRequestException(
          `Valid KEEP/RETURN decision required for item '${item.title}' (${item.id})`,
        );
      }
      completeSelections[item.id] = val;
    }

    const financials = computeTryAndBuyFinancials({
      order: {
        itemTotal: order.itemTotal,
        deliveryFee: order.deliveryFee,
        taxes: order.taxes,
        discountAmount: order.discountAmount,
        giftWrapFee: order.giftWrapFee,
        donationAmount: order.donationAmount,
        grandTotal: order.grandTotal,
        paymentMethod: order.paymentMethod,
      },
      items: order.items.map((i) => ({ id: i.id, price: i.price, quantity: i.quantity })),
      selections: completeSelections,
    });

    const keptIds = financials.keptItems.map((i) => i.id);
    const returnedIds = financials.returnedItems.map((i) => i.id);
    const now = new Date();
    const nextStage = 'SELECTION_CONFIRMED';

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { tryAndBuyDecision: completeSelections[item.id] },
        });
      }

      await tx.tryAndBuySession.upsert({
        where: { orderId: order.id },
        update: {
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: nextStage,
          customerSelectionAt: now,
          keptItemIds: keptIds,
          returnedItemIds: returnedIds,
          finalPayableTotal: financials.finalPayableTotal,
          refundAmount: financials.refundAmount,
          amountDue: financials.amountDue,
          paymentStatus:
            financials.refundAmount > 0
              ? 'REFUND_PENDING'
              : financials.amountDue > 0
                ? 'PAYMENT_PENDING'
                : 'COMPLETED',
        },
        create: {
          orderId: order.id,
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: nextStage,
          customerSelectionAt: now,
          keptItemIds: keptIds,
          returnedItemIds: returnedIds,
          finalPayableTotal: financials.finalPayableTotal,
          refundAmount: financials.refundAmount,
          amountDue: financials.amountDue,
          paymentStatus:
            financials.refundAmount > 0
              ? 'REFUND_PENDING'
              : financials.amountDue > 0
                ? 'PAYMENT_PENDING'
                : 'COMPLETED',
        },
      });
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: TNB_ORDER_INCLUDE,
    });

    const formattedOrder = formatOrderPacket(refreshed, undefined, true);
    this.trackingGateway?.broadcastStatusUpdate(order.id, order.status, {
      eventType: 'TRY_AND_BUY_UPDATED',
      stage: nextStage,
      keptItemIds: keptIds,
      returnedItemIds: returnedIds,
      finalPayableTotal: financials.finalPayableTotal,
      refundAmount: financials.refundAmount,
      amountDue: financials.amountDue,
      items: formattedOrder.items,
      order: formattedOrder,
    });

    return {
      success: true,
      keptCount: keptIds.length,
      returnedCount: returnedIds.length,
      keptSubtotal: financials.keptItemTotal,
      finalPayableTotal: financials.finalPayableTotal,
      refundAmount: financials.refundAmount,
      amountDue: financials.amountDue,
      nextStage,
      order: formattedOrder,
    };
  }

  async confirmReturnCollection(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuyReturnCollectionDto,
  ) {
    const { driver, order } = await this.resolveOrderAndDriver(driverId, orderId);

    const returnedItems = order.items.filter((i) => i.tryAndBuyDecision === 'RETURN');
    if (returnedItems.length === 0) {
      throw new BadRequestException('No items are marked for return on this order');
    }

    const returnManifestId =
      order.tryAndBuySession?.returnManifestId ||
      `RM-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const item of returnedItems) {
        if (!dto.collectedItemIds || dto.collectedItemIds.includes(item.id)) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { collectedAt: now },
          });
        }
      }

      await tx.tryAndBuySession.upsert({
        where: { orderId: order.id },
        update: {
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: 'PAYMENT_PENDING',
          returnManifestId,
          returnImages: dto.returnImages || [],
        },
        create: {
          orderId: order.id,
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: 'PAYMENT_PENDING',
          returnManifestId,
          returnImages: dto.returnImages || [],
          returnedItemIds: returnedItems.map((i) => i.id),
        },
      });
    });

    this.trackingGateway?.broadcastStatusUpdate(order.id, order.status, {
      eventType: 'TRY_AND_BUY_UPDATED',
      stage: 'PAYMENT_PENDING',
      returnManifestId,
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: TNB_ORDER_INCLUDE,
    });

    return {
      success: true,
      returnManifestId,
      collectedReturnedItemsCount: returnedItems.length,
      message: 'Returned items documented and manifested for store reconciliation.',
      order: formatOrderPacket(refreshed, undefined, true),
    };
  }

  async settlePayment(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuySettlePaymentDto,
  ) {
    const { driver, order } = await this.resolveOrderAndDriver(driverId, orderId);

    const selections: Record<string, 'KEEP' | 'RETURN'> = {};
    for (const it of order.items) {
      selections[it.id] = (it.tryAndBuyDecision === 'RETURN' ? 'RETURN' : 'KEEP');
    }

    const financials = computeTryAndBuyFinancials({
      order: {
        itemTotal: order.itemTotal,
        deliveryFee: order.deliveryFee,
        taxes: order.taxes,
        discountAmount: order.discountAmount,
        giftWrapFee: order.giftWrapFee,
        donationAmount: order.donationAmount,
        grandTotal: order.grandTotal,
        paymentMethod: order.paymentMethod,
      },
      items: order.items.map((i) => ({ id: i.id, price: i.price, quantity: i.quantity })),
      selections,
    });

    if (order.paymentMethod === 'COD' && financials.amountDue > 0 && !dto.cashCollected) {
      throw new BadRequestException(
        `Customer COD/UPI payment collection of ₹${financials.amountDue} must be confirmed before settling`,
      );
    }

    const hasReturns = financials.returnedItems.length > 0;

    if (!hasReturns) {
      const settledOrder = await this.orderTransition.executeTransition({
        orderId: order.id,
        nextStatus: 'DELIVERED',
        actorRole: Role.DRIVER,
        actorId: driver.userId,
        actorName: driver.fullName,
        note: `Try & Buy completed: Customer kept all items (Final payable ₹${financials.finalPayableTotal})`,
        auditAction: 'TRY_AND_BUY_ALL_KEPT_DELIVERED',
        netKeptSubtotalForLedger: financials.netKeptSubtotalForCommission,
        extraOrderUpdate:
          order.paymentMethod === 'COD' ? { paymentStatus: 'COMPLETED' } : undefined,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.tryAndBuySession.upsert({
          where: { orderId: order.id },
          update: {
            stage: 'COMPLETED',
            paymentStatus: 'COMPLETED',
            finalPayableTotal: financials.finalPayableTotal,
            refundAmount: 0,
            amountDue: 0,
          },
          create: {
            orderId: order.id,
            driverId: driver.userId,
            driverProfileId: driver.id,
            stage: 'COMPLETED',
            paymentStatus: 'COMPLETED',
            finalPayableTotal: financials.finalPayableTotal,
            refundAmount: 0,
            amountDue: 0,
          },
        });
        await tx.driverProfile.update({
          where: { id: driver.id },
          data: { completedDeliveries: { increment: 1 }, availableSince: new Date() },
        });
      });

      return {
        success: true,
        orderStatus: 'DELIVERED',
        hasReturns: false,
        finalPayableTotal: financials.finalPayableTotal,
        refundAmount: 0,
        order: formatOrderPacket(settledOrder, undefined, true),
      };
    }

    const returningOrder = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'RETURNING',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note: `Customer returning ${financials.returnedItems.length} item(s). Rider heading to store for supervisor reconciliation.`,
      auditAction: 'TRY_AND_BUY_RETURNING_TO_STORE',
      extraOrderUpdate:
        order.paymentMethod === 'COD' && dto.cashCollected
          ? { paymentStatus: 'COMPLETED' }
          : undefined,
    });

    await this.prisma.tryAndBuySession.upsert({
      where: { orderId: order.id },
      update: {
        stage: 'RETURNING_TO_STORE',
        paymentStatus:
          order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
            ? 'REFUND_PENDING'
            : 'COMPLETED',
        finalPayableTotal: financials.finalPayableTotal,
        refundAmount: financials.refundAmount,
        amountDue: financials.amountDue,
      },
      create: {
        orderId: order.id,
        driverId: driver.userId,
        driverProfileId: driver.id,
        stage: 'RETURNING_TO_STORE',
        paymentStatus:
          order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
            ? 'REFUND_PENDING'
            : 'COMPLETED',
        finalPayableTotal: financials.finalPayableTotal,
        refundAmount: financials.refundAmount,
        amountDue: financials.amountDue,
      },
    });

    return {
      success: true,
      orderStatus: 'RETURNING',
      hasReturns: true,
      finalPayableTotal: financials.finalPayableTotal,
      refundAmount: financials.refundAmount,
      order: formatOrderPacket(returningOrder, undefined, true),
    };
  }

  async arriveAtStore(driverId: string | undefined, orderId: string) {
    const { driver, order } = await this.resolveOrderAndDriver(driverId, orderId);

    if (order.status !== 'RETURNING') {
      throw new BadRequestException(
        `Store arrival applies only when order is RETURNING (current: ${order.status})`,
      );
    }

    await this.prisma.tryAndBuySession.upsert({
      where: { orderId: order.id },
      update: { stage: 'STORE_RECONCILIATION' },
      create: {
        orderId: order.id,
        driverId: driver.userId,
        driverProfileId: driver.id,
        stage: 'STORE_RECONCILIATION',
      },
    });

    this.trackingGateway?.broadcastStatusUpdate(order.id, order.status, {
      eventType: 'TRY_AND_BUY_UPDATED',
      stage: 'STORE_RECONCILIATION',
    });

    const refreshed = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: TNB_ORDER_INCLUDE,
    });

    return {
      success: true,
      message: 'Driver arrived back at store. Ready for supervisor reconciliation.',
      order: formatOrderPacket(refreshed, undefined, true),
    };
  }

  async reconcileStoreReturn(
    driverId: string | undefined,
    orderId: string,
    dto: TryAndBuyReconciliationDto,
  ) {
    const { driver, order } = await this.resolveOrderAndDriver(driverId, orderId);

    if (order.status !== 'RETURNING') {
      throw new BadRequestException(
        `Store return reconciliation requires order status RETURNING (current: ${order.status})`,
      );
    }

    if (!dto.supervisorConfirmed) {
      throw new BadRequestException(
        'Store supervisor confirmation is required to complete return reconciliation',
      );
    }

    const selections: Record<string, 'KEEP' | 'RETURN'> = {};
    for (const it of order.items) {
      selections[it.id] = (it.tryAndBuyDecision === 'RETURN' ? 'RETURN' : 'KEEP');
    }

    const financials = computeTryAndBuyFinancials({
      order: {
        itemTotal: order.itemTotal,
        deliveryFee: order.deliveryFee,
        taxes: order.taxes,
        discountAmount: order.discountAmount,
        giftWrapFee: order.giftWrapFee,
        donationAmount: order.donationAmount,
        grandTotal: order.grandTotal,
        paymentMethod: order.paymentMethod,
      },
      items: order.items.map((i) => ({ id: i.id, price: i.price, quantity: i.quantity })),
      selections,
    });

    // Restore returned items inventory inside a transaction BEFORE transitioning
    await this.prisma.$transaction(async (tx) => {
      for (const returnedItem of financials.returnedItems) {
        const orderItemRow = order.items.find((i) => i.id === returnedItem.id);
        if (orderItemRow) {
          await tx.product.updateMany({
            where: { id: orderItemRow.productId },
            data: { stockQuantity: { increment: orderItemRow.quantity || 1 } },
          });
        }
      }

      await tx.tryAndBuySession.upsert({
        where: { orderId: order.id },
        update: {
          stage: 'COMPLETED',
          storeReconciliationStatus: 'RECONCILED',
          storeReconciledAt: new Date(),
          finalPayableTotal: financials.finalPayableTotal,
          refundAmount: financials.refundAmount,
          paymentStatus:
            order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
              ? 'REFUND_PENDING'
              : 'COMPLETED',
        },
        create: {
          orderId: order.id,
          driverId: driver.userId,
          driverProfileId: driver.id,
          stage: 'COMPLETED',
          storeReconciliationStatus: 'RECONCILED',
          storeReconciledAt: new Date(),
          finalPayableTotal: financials.finalPayableTotal,
          refundAmount: financials.refundAmount,
          paymentStatus:
            order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
              ? 'REFUND_PENDING'
              : 'COMPLETED',
        },
      });

      await tx.driverProfile.update({
        where: { id: driver.id },
        data: { completedDeliveries: { increment: 1 }, availableSince: new Date() },
      });
    });

    const extraOutboxEvents =
      order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
        ? [
            {
              aggregateType: 'PAYMENT',
              eventType: QueueJobType.REFUND_PROCESSING,
              payload: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                paymentId: order.razorpayPaymentId,
                refundAmount: financials.refundAmount,
                reason: 'Try & Buy return reconciliation refund',
                isTryAndBuy: true,
              },
            },
          ]
        : [];

    const returnedOrder = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'RETURNED',
      actorRole: Role.DRIVER,
      actorId: driver.userId,
      actorName: driver.fullName,
      note:
        dto.note?.trim() ||
        `Store return reconciled (${financials.returnedItems.length} returned, ${financials.keptItems.length} kept).`,
      auditAction: 'TRY_AND_BUY_STORE_RECONCILED',
      netKeptSubtotalForLedger: financials.netKeptSubtotalForCommission,
      extraOrderUpdate:
        order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
          ? { paymentStatus: 'REFUND_PENDING' }
          : undefined,
      extraOutboxEvents,
    });

    return {
      success: true,
      message: 'Store return verified & reconciled. Inventory restored.',
      reconciledAt: new Date().toISOString(),
      restoredItemsCount: financials.returnedItems.length,
      refundQueued: extraOutboxEvents.length > 0,
      refundAmount: financials.refundAmount,
      order: formatOrderPacket(returnedOrder, undefined, true),
    };
  }
}
