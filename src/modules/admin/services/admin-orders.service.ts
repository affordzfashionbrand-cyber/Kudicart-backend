import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminQueryDto } from '../dto/admin-query.dto';
import { AdminAssignDriverDto } from '../dto/admin-domain.dto';
import { OrderTransitionService } from '../../orders/order-transition.service';
import { DeliveryAssignmentService } from '../../orders/delivery-assignment.service';
import { computeTryAndBuyFinancials } from '../../orders/order-pricing.util';
import { QueueJobType } from '../../queue/queue.constants';
import { Role } from '../../../common/enums/role.enum';

const ADMIN_ORDER_INCLUDE = {
  customer: {
    select: { id: true, name: true, phone: true, email: true },
  },
  vendor: true,
  address: true,
  driver: {
    select: { id: true, name: true, phone: true },
  },
  driverProfile: true,
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  tryAndBuySession: true,
  dispatchAssignment: true,
  checkoutGroup: true,
};

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderTransition: OrderTransitionService,
    @Optional() private readonly deliveryAssignment?: DeliveryAssignmentService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private mapOrderToAdmin(order: any) {
    const addr = order.deliveryAddress || order.address || {};
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      version: order.version ?? 1,
      checkoutGroupId: order.checkoutGroupId ?? null,
      groupNumber: order.checkoutGroup?.groupNumber ?? null,
      status: order.status,
      orderType: order.orderType || (order.isTryAndBuy ? 'TRY_AND_BUY' : 'STANDARD'),
      deliveryAssignmentStatus: order.deliveryAssignmentStatus || 'NOT_ASSIGNED',
      assignmentFailureReason: order.assignmentFailureReason ?? null,
      fulfillmentType: order.fulfillmentType || 'DARK_STORE',
      isTryAndBuy: Boolean(order.isTryAndBuy),
      deliveryInstructions: order.deliveryInstructions ?? null,
      needGstInvoice: Boolean(order.needGstInvoice),
      customerGstin: order.customerGstin ?? null,
      gstBusinessName: order.gstBusinessName ?? null,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      razorpayOrderId: order.razorpayOrderId ?? null,
      razorpayPaymentId: order.razorpayPaymentId ?? null,
      customerId: order.customerId,
      customerName: order.customer?.name || addr.recipientName || 'Customer',
      customerPhone: order.customer?.phone || addr.recipientPhone || null,
      deliveryAddress: {
        line1: addr.line1 || null,
        line2: addr.line2 || null,
        locality: addr.locality || null,
        city: addr.city || null,
        pincode: addr.pincode || null,
        label: addr.label || null,
        recipientName: addr.recipientName || null,
        recipientPhone: addr.recipientPhone || null,
      },
      vendorId: order.vendorId ?? null,
      vendorName: order.vendor?.storeName || 'Affordz Official Store',
      driverId: order.driverId ?? null,
      driverProfileId: order.driverProfileId ?? null,
      driverName: order.driverProfile?.fullName || order.driver?.name || null,
      driverPhone: order.driverProfile?.phone || order.driver?.phone || null,
      driverVehicle: order.driverProfile?.vehicleType || null,
      itemTotal: Math.round(order.itemTotal || 0),
      deliveryFee: Math.round(order.deliveryFee || 0),
      taxes: Math.round(order.taxes || 0),
      giftWrapFee: Math.round(order.giftWrapFee || 0),
      donationAmount: Math.round(order.donationAmount || 0),
      discountAmount: Math.round(order.discountAmount || 0),
      couponCode: order.couponCode ?? null,
      grandTotal: Math.round(order.grandTotal || 0),
      etaMinutes: order.etaMinutes ?? 0,
      acceptedAt: order.acceptedAt ? new Date(order.acceptedAt).toISOString() : null,
      packingStartedAt: order.packingStartedAt ? new Date(order.packingStartedAt).toISOString() : null,
      readyForPickupAt: order.readyForPickupAt ? new Date(order.readyForPickupAt).toISOString() : null,
      pickedUpAt: order.pickedUpAt ? new Date(order.pickedUpAt).toISOString() : null,
      tryAndBuyStartedAt: order.tryAndBuyStartedAt ? new Date(order.tryAndBuyStartedAt).toISOString() : null,
      arrivedAt: order.arrivedAt ? new Date(order.arrivedAt).toISOString() : null,
      deliveredAt: order.deliveredAt ? new Date(order.deliveredAt).toISOString() : null,
      returnedAt: order.returnedAt ? new Date(order.returnedAt).toISOString() : null,
      returnReason: order.returnReason ?? null,
      cancelledAt: order.cancelledAt ? new Date(order.cancelledAt).toISOString() : null,
      cancellationReason: order.cancellationReason ?? null,
      rejectedByVendor: Boolean(order.rejectedByVendor),
      expiresAt: order.expiresAt ? new Date(order.expiresAt).toISOString() : null,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
      items: order.items || [],
      history: (order.history || []).map((h: any) => ({
        id: h.id,
        status: h.status,
        note: h.note,
        actorId: h.actorId ?? null,
        actorRole: h.actorRole ?? null,
        createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
      })),
      tryAndBuySession: order.tryAndBuySession || null,
      dispatchAssignment: order.dispatchAssignment || null,
    };
  }

  async listOrders(query: AdminQueryDto) {
    this.ensureDbConnected();

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;

    const where: any = {};
    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }
    if (query.fulfillmentType && query.fulfillmentType !== 'ALL') {
      if (query.fulfillmentType === 'TRY_AND_BUY') {
        where.isTryAndBuy = true;
      } else {
        where.fulfillmentType = query.fulfillmentType;
      }
    }
    if (query.vendor && query.vendor !== 'ALL') {
      where.vendorId = query.vendor;
    }

    const rawOrders = await this.prisma.order.findMany({
      where,
      include: ADMIN_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    let mapped = rawOrders.map((o) => this.mapOrderToAdmin(o));

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      mapped = mapped.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.customerName || '').toLowerCase().includes(q) ||
          (o.vendorName || '').toLowerCase().includes(q) ||
          (o.driverName || '').toLowerCase().includes(q),
      );
    }

    const total = mapped.length;
    const paginated = mapped.slice((page - 1) * limit, page * limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getOrderById(id: string) {
    this.ensureDbConnected();
    const cleanId = id.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id }, { id: cleanId }, { orderNumber: cleanId }],
      },
      include: ADMIN_ORDER_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException(`Order #${id} could not be located.`);
    }

    return this.mapOrderToAdmin(order);
  }

  async assignDriver(
    orderId: string,
    dto: AdminAssignDriverDto,
    actorId?: string,
    actorName?: string,
  ) {
    this.ensureDbConnected();
    if (!this.deliveryAssignment) {
      throw new ServiceUnavailableException('Delivery assignment service unavailable.');
    }

    const { driver, order: updated } = await this.deliveryAssignment.assignManually(
      orderId,
      dto.driverId,
      {
        actorId: actorId || null,
        actorRole: Role.ADMIN,
        actorName: actorName || 'Operations Admin',
      },
      dto.note,
    );

    return {
      success: true,
      message: `Successfully assigned ${driver.fullName} to order #${updated?.orderNumber || orderId}.`,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async acceptOrder(orderId: string, actorId?: string, actorName?: string) {
    this.ensureDbConnected();
    const updated = await this.orderTransition.executeTransition({
      orderId,
      nextStatus: 'ACCEPTED',
      actorRole: Role.ADMIN,
      actorId: actorId || null,
      actorName: actorName || 'Operations Admin',
      note: 'Admin accepted order; automatic delivery partner assignment triggered',
      auditAction: 'ADMIN_ORDER_ACCEPTED',
      triggerAutoAssignment: true,
    });
    return {
      success: true,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async prepareOrder(orderId: string, actorId?: string, actorName?: string) {
    this.ensureDbConnected();
    const updated = await this.orderTransition.executeTransition({
      orderId,
      nextStatus: 'PACKING',
      actorRole: Role.ADMIN,
      actorId: actorId || null,
      actorName: actorName || 'Operations Admin',
      note: 'Order is getting packed',
      auditAction: 'ADMIN_ORDER_PACKING',
    });
    return {
      success: true,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async readyForPickup(orderId: string, actorId?: string, actorName?: string) {
    this.ensureDbConnected();
    let updated = await this.orderTransition.executeTransition({
      orderId,
      nextStatus: 'READY_FOR_PICKUP',
      actorRole: Role.ADMIN,
      actorId: actorId || null,
      actorName: actorName || 'Operations Admin',
      note: 'Order packed and ready for delivery partner pickup',
      auditAction: 'ADMIN_ORDER_READY_FOR_PICKUP',
    });

    if (
      updated &&
      this.deliveryAssignment &&
      updated.deliveryAssignmentStatus !== 'ASSIGNED' &&
      updated.deliveryAssignmentStatus !== 'ACCEPTED_BY_DELIVERY_PARTNER'
    ) {
      const retry = await this.deliveryAssignment
        .retryOrderAssignment(updated.id, {
          actorId: actorId || null,
          actorRole: Role.ADMIN,
          actorName: actorName || 'Operations Admin',
        })
        .catch(() => null);
      if (retry?.order) {
        updated = retry.order;
      }
    }

    return {
      success: true,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async cancelOrder(
    orderId: string,
    actorId?: string,
    actorName?: string,
    reason?: string,
    expectedVersion?: number,
  ) {
    this.ensureDbConnected();
    const cleanReason = reason?.trim() || 'Cancelled by Operations Admin';
    const updated = await this.orderTransition.executeTransition({
      orderId,
      nextStatus: 'CANCELLED',
      actorRole: Role.ADMIN,
      actorId: actorId || null,
      actorName: actorName || 'Operations Admin',
      note: cleanReason,
      expectedVersion,
      auditAction: 'ADMIN_ORDER_CANCELLED',
      extraOrderUpdate: {
        cancellationReason: cleanReason,
      },
    });
    return {
      success: true,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async retryAssignment(orderId: string, actorId?: string, actorName?: string) {
    this.ensureDbConnected();
    if (!this.deliveryAssignment) {
      throw new ServiceUnavailableException('Delivery assignment service unavailable.');
    }
    const res = await this.deliveryAssignment.retryOrderAssignment(orderId, {
      actorId: actorId || null,
      actorRole: Role.ADMIN,
      actorName: actorName || 'Operations Admin',
    });
    return {
      success: res.assignRes.assigned,
      assignmentResult: res.assignRes,
      order: this.mapOrderToAdmin(res.order),
    };
  }

  async reconcileReturn(
    orderId: string,
    actorId?: string,
    actorName?: string,
    note?: string,
  ) {
    this.ensureDbConnected();
    const cleanId = orderId.trim().replace(/^#/, '');
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
      include: ADMIN_ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }
    if (order.status !== 'RETURNING') {
      throw new BadRequestException(
        `Store return reconciliation requires RETURNING state (current: ${order.status})`,
      );
    }

    const selections: Record<string, 'KEEP' | 'RETURN'> = {};
    for (const it of order.items || []) {
      selections[it.id] = it.tryAndBuyDecision === 'RETURN' ? 'RETURN' : 'KEEP';
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
      items: (order.items || []).map((i: any) => ({
        id: i.id,
        price: i.price,
        quantity: i.quantity,
      })),
      selections,
    });

    const alreadyReconciled = order.tryAndBuySession?.storeReconciliationStatus === 'RECONCILED';
    const extraOutboxEvents =
      order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0 && !alreadyReconciled
        ? [
            {
              aggregateType: 'PAYMENT',
              eventType: QueueJobType.REFUND_PROCESSING,
              payload: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                paymentId: order.razorpayPaymentId,
                refundAmount: financials.refundAmount,
                reason: 'Try & Buy admin store reconciliation refund',
                isTryAndBuy: true,
              },
            },
          ]
        : [];

    if (!alreadyReconciled) {
      await this.prisma.$transaction(async (tx) => {
        for (const ret of financials.returnedItems) {
          const itemRow = (order.items || []).find((i: any) => i.id === ret.id);
          if (itemRow) {
            await tx.product.updateMany({
              where: { id: itemRow.productId },
              data: { stockQuantity: { increment: itemRow.quantity || 1 } },
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
            driverId: order.driverId || null,
            driverProfileId: order.driverProfileId || null,
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
        if (order.driverProfileId) {
          await tx.driverProfile.update({
            where: { id: order.driverProfileId },
            data: { completedDeliveries: { increment: 1 }, availableSince: new Date() },
          });
        }
      });
    }

    const updated = await this.orderTransition.executeTransition({
      orderId: order.id,
      nextStatus: 'RETURNED',
      actorRole: Role.ADMIN,
      actorId: actorId || null,
      actorName: actorName || 'Operations Admin',
      note:
        note?.trim() ||
        `Admin reconciled store return (${financials.returnedItems.length} returned, ${financials.keptItems.length} kept).`,
      auditAction: 'ADMIN_RETURN_RECONCILED',
      netKeptSubtotalForLedger: financials.netKeptSubtotalForCommission,
      extraOrderUpdate: {
        ...(order.paymentMethod === 'RAZORPAY' && financials.refundAmount > 0
          ? { paymentStatus: 'REFUND_PENDING' }
          : {}),
        ...(note?.trim() ? { returnReason: note.trim() } : {}),
      },
      extraOutboxEvents,
    });

    return {
      success: true,
      order: this.mapOrderToAdmin(updated),
    };
  }

  async listAssignments(query: AdminQueryDto) {
    this.ensureDbConnected();

    const orders = await this.prisma.order.findMany({
      where: {
        OR: [
          {
            status: {
              in: ['ACCEPTED', 'PACKING', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED'] as any[],
            },
          },
          {
            deliveryAssignmentStatus: {
              in: [
                'ASSIGNMENT_PENDING',
                'ASSIGNED',
                'ACCEPTED_BY_DELIVERY_PARTNER',
                'REJECTED_BY_DELIVERY_PARTNER',
                'REASSIGNMENT_PENDING',
                'FAILED',
              ],
            },
            status: {
              notIn: ['DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED'],
            },
          },
        ],
      },
      include: ADMIN_ORDER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    let mapped = orders.map((o) => this.mapOrderToAdmin(o));

    if (query.status && query.status !== 'ALL') {
      if (query.status === 'READY') {
        mapped = mapped.filter(
          (o) =>
            o.status === 'READY_FOR_PICKUP' &&
            !['ASSIGNED', 'ACCEPTED_BY_DELIVERY_PARTNER'].includes(o.deliveryAssignmentStatus),
        );
      } else if (query.status === 'FAILED') {
        mapped = mapped.filter((o) =>
          ['FAILED', 'ASSIGNMENT_PENDING', 'REASSIGNMENT_PENDING', 'REJECTED_BY_DELIVERY_PARTNER'].includes(
            o.deliveryAssignmentStatus,
          ),
        );
      } else if (query.status === 'ASSIGNED') {
        mapped = mapped.filter((o) =>
          ['ASSIGNED', 'ACCEPTED_BY_DELIVERY_PARTNER'].includes(o.deliveryAssignmentStatus),
        );
      } else {
        mapped = mapped.filter((o) => o.status === query.status);
      }
    }

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      mapped = mapped.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          (o.customerName || '').toLowerCase().includes(q) ||
          (o.vendorName || '').toLowerCase().includes(q) ||
          (o.driverName || '').toLowerCase().includes(q),
      );
    }

    const allMapped = orders.map((o) => this.mapOrderToAdmin(o));

    return {
      data: mapped,
      total: mapped.length,
      readyCount: allMapped.filter((o) => o.status === 'READY_FOR_PICKUP').length,
      assignedCount: allMapped.filter((o) =>
        ['ASSIGNED', 'ACCEPTED_BY_DELIVERY_PARTNER'].includes(o.deliveryAssignmentStatus),
      ).length,
      failedCount: allMapped.filter((o) =>
        ['FAILED', 'ASSIGNMENT_PENDING', 'REASSIGNMENT_PENDING', 'REJECTED_BY_DELIVERY_PARTNER'].includes(
          o.deliveryAssignmentStatus,
        ),
      ).length,
    };
  }
}
